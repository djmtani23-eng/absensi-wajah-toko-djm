import React, { useState, useRef, useCallback, useEffect } from 'react';
import Webcam from 'react-webcam';
import { Camera, MapPin, CheckCircle2, XCircle, RefreshCcw, Clock, Calendar, ArrowLeft, History, User, Shield, Download, FileSpreadsheet } from 'lucide-react';
import { format } from 'date-fns';
import { id } from 'date-fns/locale';
import { motion, AnimatePresence } from 'motion/react';
import { collection, query, orderBy, onSnapshot, setDoc, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from './firebase';

type AttendanceSession = 'datang' | 'pulang';
type AppStep = 'home' | 'name' | 'camera' | 'location' | 'summary' | 'history' | 'admin';

interface AttendanceRecord {
  id: string;
  employeeName: string;
  type: AttendanceSession;
  photo: string;
  timestamp: string; // ISO string for storage
  location: {
    lat: number;
    lng: number;
    address?: string;
  };
}

export default function App() {
  const [step, setStep] = useState<AppStep>('home');
  const [session, setSession] = useState<AttendanceSession | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [location, setLocation] = useState<AttendanceRecord['location'] | null>(null);
  const [employeeName, setEmployeeName] = useState('');
  const [history, setHistory] = useState<AttendanceRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const webcamRef = useRef<Webcam>(null);

  // Load local cache as instantaneous offline fallback
  useEffect(() => {
    const saved = localStorage.getItem('attendance_history');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        setHistory(parsed);
      } catch (e) {
        console.error('Failed to parse history', e);
      }
    }
  }, []);

  // Hook into Firestore for real-time, zero-latency multi-device sync
  useEffect(() => {
    const q = query(collection(db, 'attendance'), orderBy('timestamp', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const records: AttendanceRecord[] = [];
      snapshot.forEach((snapDoc) => {
        records.push(snapDoc.data() as AttendanceRecord);
      });
      setHistory(records);
      localStorage.setItem('attendance_history', JSON.stringify(records));
    }, (error) => {
      console.error('Firestore snapshot listener failed', error);
    });

    return () => unsubscribe();
  }, []);

  const startAttendance = (type: AttendanceSession) => {
    setSession(type);
    setStep('name');
    setEmployeeName('');
    setPhoto(null);
    setLocation(null);
    setError(null);
  };

  const capturePhoto = useCallback(() => {
    const imageSrc = webcamRef.current?.getScreenshot();
    if (imageSrc) {
      // Compress the image using canvas to ensure small file size (under 100KB)
      // to comply with Firestore's 1MB document size limit and rules constraints.
      const img = new Image();
      img.src = imageSrc;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const targetWidth = 480;
        const targetHeight = 640;
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          try {
            const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.7);
            setPhoto(compressedDataUrl);
          } catch (e) {
            console.warn('Canvas conversion failed, falling back to original high-res image', e);
            setPhoto(imageSrc);
          }
        } else {
          setPhoto(imageSrc);
        }
        setStep('location');
        fetchLocation();
      };
      img.onerror = () => {
        setPhoto(imageSrc);
        setStep('location');
        fetchLocation();
      };
    } else {
      setError('Gagal mengambil foto. Pastikan kamera aktif.');
    }
  }, [webcamRef]);

  const fetchLocation = () => {
    setLoading(true);
    setError(null);
    if (!navigator.geolocation) {
      setError('Geolocation tidak didukung oleh browser Anda.');
      setLoading(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setLocation({ lat: latitude, lng: longitude });
        setLoading(false);
      },
      (err) => {
        setError('Gagal mendapatkan lokasi. Pastikan GPS aktif.');
        setLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const saveAttendance = async () => {
    if (photo && location && session && employeeName) {
      setLoading(true);
      setError(null);
      const recordId = Date.now().toString();
      const newRecord: AttendanceRecord = {
        id: recordId,
        employeeName,
        type: session,
        photo,
        timestamp: new Date().toISOString(),
        location,
      };

      try {
        await setDoc(doc(db, 'attendance', recordId), newRecord);
        setStep('summary');
      } catch (err) {
        console.error('Failed to save to Firestore', err);
        setError('Gagal menyimpan data absensi ke server Cloud.');
        handleFirestoreError(err, OperationType.WRITE, `attendance/${recordId}`);
      } finally {
        setLoading(false);
      }
    }
  };

  const resetProcess = () => {
    setStep('home');
    setSession(null);
    setPhoto(null);
    setLocation(null);
    setError(null);
  };

  const downloadRecapitulation = () => {
    if (history.length === 0) {
      alert('Tidak ada data untuk diunduh.');
      return;
    }

    // Create CSV content
    const headers = ['ID', 'Nama Karyawan', 'Tipe', 'Tanggal', 'Waktu', 'Latitude', 'Longitude'];
    const rows = history.map(record => {
      const date = new Date(record.timestamp);
      return [
        record.id,
        record.employeeName,
        record.type,
        format(date, 'yyyy-MM-dd'),
        format(date, 'HH:mm:ss'),
        record.location.lat,
        record.location.lng
      ].join(',');
    });

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `rekapitulasi_absen_${format(new Date(), 'yyyyMMdd_HHmm')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const renderHome = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] space-y-8 p-6">
      <div className="text-center space-y-2">
        <h1 className="text-4xl font-bold tracking-tight text-zinc-900">Absensi Karyawan</h1>
        <p className="text-zinc-500">Silakan pilih sesi absensi Anda hari ini.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-md">
        <button
          onClick={() => startAttendance('datang')}
          className="flex flex-col items-center justify-center p-8 bg-emerald-50 border-2 border-emerald-100 rounded-3xl hover:bg-emerald-100 transition-all group"
        >
          <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform">
            <Clock size={32} />
          </div>
          <span className="text-xl font-semibold text-emerald-900">Absen Datang</span>
          <span className="text-sm text-emerald-600 mt-1">Mulai kerja</span>
        </button>

        <button
          onClick={() => startAttendance('pulang')}
          className="flex flex-col items-center justify-center p-8 bg-zinc-50 border-2 border-zinc-100 rounded-3xl hover:bg-zinc-100 transition-all group"
        >
          <div className="w-16 h-16 bg-zinc-800 rounded-2xl flex items-center justify-center text-white mb-4 group-hover:scale-110 transition-transform">
            <Clock size={32} />
          </div>
          <span className="text-xl font-semibold text-zinc-900">Absen Pulang</span>
          <span className="text-sm text-zinc-600 mt-1">Selesai kerja</span>
        </button>
      </div>

      <button
        onClick={() => setStep('history')}
        className="flex items-center gap-2 text-zinc-500 hover:text-zinc-800 transition-colors"
      >
        <History size={20} />
        <span>Lihat Riwayat Absensi</span>
      </button>
    </div>
  );

  const renderNameInput = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-6 space-y-8">
      <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-xl border border-zinc-100 space-y-6">
        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-zinc-900">Nama Karyawan</h2>
          <p className="text-zinc-500">Silakan masukkan nama lengkap Anda.</p>
        </div>

        <div className="space-y-4">
          <div className="relative">
            <input
              type="text"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              placeholder="Tulis nama Anda di sini..."
              className="w-full px-6 py-4 bg-zinc-50 border-2 border-zinc-100 rounded-2xl focus:border-emerald-500 focus:outline-none transition-all font-semibold text-zinc-900"
              autoFocus
            />
          </div>

          <button
            onClick={() => employeeName.trim() && setStep('camera')}
            disabled={!employeeName.trim()}
            className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-600 disabled:opacity-50 disabled:shadow-none transition-all"
          >
            Lanjutkan ke Foto
          </button>
          
          <button
            onClick={resetProcess}
            className="w-full py-4 bg-zinc-100 text-zinc-600 rounded-2xl font-bold hover:bg-zinc-200 transition-all"
          >
            Batal
          </button>
        </div>
      </div>
    </div>
  );

  const renderCamera = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-4 space-y-6">
      <div className="w-full max-w-md aspect-[3/4] bg-zinc-200 rounded-3xl overflow-hidden relative border-4 border-white shadow-2xl">
        <Webcam
          audio={false}
          ref={webcamRef}
          screenshotFormat="image/jpeg"
          videoConstraints={{ facingMode: 'user' }}
          className="w-full h-full object-cover"
          disablePictureInPicture={false}
          forceScreenshotSourceSize={false}
          imageSmoothing={true}
          mirrored={false}
          onUserMedia={() => {}}
          onUserMediaError={() => {}}
          screenshotQuality={1}
          minScreenshotHeight={0}
          minScreenshotWidth={0}
        />
        <div className="absolute inset-0 border-[20px] border-black/10 pointer-events-none"></div>
      </div>

      <div className="flex flex-col items-center gap-4">
        <button
          onClick={capturePhoto}
          className="w-20 h-20 bg-white border-8 border-zinc-100 rounded-full flex items-center justify-center shadow-lg hover:scale-105 active:scale-95 transition-all"
        >
          <div className="w-12 h-12 bg-emerald-500 rounded-full flex items-center justify-center text-white">
            <Camera size={24} />
          </div>
        </button>
        <p className="text-zinc-500 font-medium">Ambil Foto Selfie</p>
      </div>

      <button onClick={resetProcess} className="text-zinc-400 hover:text-zinc-600">Batal</button>
    </div>
  );

  const renderLocation = () => (
    <div className="flex flex-col items-center justify-center min-h-[80vh] p-6 space-y-8">
      <div className="w-full max-w-md bg-white rounded-3xl p-8 shadow-xl border border-zinc-100 space-y-6">
        <div className="flex items-center justify-center">
          {loading ? (
            <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
          ) : error ? (
            <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center text-red-600">
              <XCircle size={32} />
            </div>
          ) : (
            <div className="w-16 h-16 bg-emerald-100 rounded-full flex items-center justify-center text-emerald-600">
              <MapPin size={32} />
            </div>
          )}
        </div>

        <div className="text-center space-y-2">
          <h2 className="text-2xl font-bold text-zinc-900">
            {loading ? 'Mencari Lokasi...' : error ? 'Error Lokasi' : 'Lokasi Ditemukan'}
          </h2>
          {location && (
            <p className="text-zinc-500 font-mono text-sm">
              {location.lat.toFixed(6)}, {location.lng.toFixed(6)}
            </p>
          )}
          {error && <p className="text-red-500 text-sm">{error}</p>}
        </div>

        {location && !error && (
          <div className="w-full h-40 bg-zinc-100 rounded-2xl overflow-hidden relative">
            <img
              src={`https://picsum.photos/seed/${location.lat}/400/200`}
              alt="Map Placeholder"
              className="w-full h-full object-cover opacity-50 grayscale"
              referrerPolicy="no-referrer"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <a
                href={`https://www.google.com/maps?q=${location.lat},${location.lng}`}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-white px-4 py-2 rounded-full shadow-md text-sm font-medium text-emerald-600 flex items-center gap-2 hover:bg-emerald-50 transition-colors"
              >
                <MapPin size={16} />
                Lihat di Google Maps
              </a>
            </div>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {!loading && !error && (
            <button
              onClick={saveAttendance}
              className="w-full py-4 bg-emerald-500 text-white rounded-2xl font-bold shadow-lg shadow-emerald-200 hover:bg-emerald-600 transition-all"
            >
              Simpan Absensi
            </button>
          )}
          {(error || !loading) && (
            <button
              onClick={error ? fetchLocation : resetProcess}
              className="w-full py-4 bg-zinc-100 text-zinc-600 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-200 transition-all"
            >
              <RefreshCcw size={18} />
              {error ? 'Coba Lagi' : 'Ulangi Proses'}
            </button>
          )}
        </div>
      </div>
    </div>
  );

  const renderSummary = () => {
    const lastRecord = history[0];
    if (!lastRecord) return null;

    return (
      <div className="flex flex-col items-center justify-center min-h-[80vh] p-6 space-y-8">
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="w-full max-w-md bg-white rounded-3xl overflow-hidden shadow-2xl border border-zinc-100"
        >
          <div className="bg-emerald-500 p-6 text-white text-center">
            <div className="flex justify-center mb-2">
              <CheckCircle2 size={48} />
            </div>
            <h2 className="text-2xl font-bold">Absensi Berhasil!</h2>
            <p className="opacity-90">Data Anda telah tercatat di sistem.</p>
          </div>

          <div className="p-6 space-y-6">
            <div className="flex gap-4">
              <div className="w-24 h-32 bg-zinc-100 rounded-xl overflow-hidden flex-shrink-0 border border-zinc-200">
                <img src={lastRecord.photo} alt="Selfie" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 space-y-3">
                <div>
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Nama Karyawan</p>
                  <p className="font-bold text-zinc-900">{lastRecord.employeeName}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Tipe Absensi</p>
                  <p className="font-bold text-zinc-900 capitalize">{lastRecord.type}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Waktu</p>
                  <p className="font-bold text-zinc-900">{format(new Date(lastRecord.timestamp), 'HH:mm:ss')}</p>
                </div>
                <div>
                  <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Tanggal</p>
                  <p className="font-bold text-zinc-900">{format(new Date(lastRecord.timestamp), 'EEEE, d MMMM yyyy', { locale: id })}</p>
                </div>
              </div>
            </div>

            <div className="pt-4 border-t border-zinc-100">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-2">Lokasi Terdeteksi</p>
              <div className="flex items-start gap-2 text-zinc-600">
                <MapPin size={18} className="mt-0.5 flex-shrink-0" />
                <span className="text-sm font-medium">
                  {lastRecord.location.lat.toFixed(6)}, {lastRecord.location.lng.toFixed(6)}
                </span>
              </div>
            </div>

            <button
              onClick={resetProcess}
              className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold hover:bg-zinc-800 transition-all"
            >
              Kembali ke Beranda
            </button>
          </div>
        </motion.div>
      </div>
    );
  };

  const renderHistory = () => (
    <div className="max-w-2xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <button onClick={() => setStep('home')} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-2xl font-bold text-zinc-900">Riwayat Absensi</h2>
        <div className="w-10"></div>
      </div>

      {history.length === 0 ? (
        <div className="text-center py-20 text-zinc-400">
          <History size={48} className="mx-auto mb-4 opacity-20" />
          <p>Belum ada riwayat absensi.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {history.map((record) => (
            <div key={record.id} className="bg-white p-4 rounded-2xl shadow-sm border border-zinc-100 flex gap-4">
              <div className="w-16 h-20 bg-zinc-100 rounded-lg overflow-hidden flex-shrink-0">
                <img src={record.photo} alt="Selfie" className="w-full h-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${record.type === 'datang' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-700'}`}>
                    {record.type.toUpperCase()}
                  </span>
                  <span className="text-xs text-zinc-400">{format(new Date(record.timestamp), 'd MMM yyyy')}</span>
                </div>
                <p className="font-bold text-zinc-900 leading-tight">{record.employeeName}</p>
                <p className="text-sm font-medium text-zinc-500">{format(new Date(record.timestamp), 'HH:mm')}</p>
                <div className="flex items-center gap-1 text-zinc-400 text-xs mt-1 truncate">
                  <MapPin size={12} />
                  <span>{record.location.lat.toFixed(4)}, {record.location.lng.toFixed(4)}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderAdmin = () => (
    <div className="max-w-4xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between">
        <button onClick={() => setStep('home')} className="p-2 hover:bg-zinc-100 rounded-full transition-colors">
          <ArrowLeft size={24} />
        </button>
        <h2 className="text-2xl font-bold text-zinc-900">Panel Admin</h2>
        <div className="w-10"></div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-3xl shadow-sm border border-zinc-100 space-y-2">
          <p className="text-xs font-bold text-zinc-400 uppercase tracking-wider">Total Absensi</p>
          <p className="text-3xl font-bold text-zinc-900">{history.length}</p>
        </div>
        <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 space-y-2">
          <p className="text-xs font-bold text-emerald-600 uppercase tracking-wider">Absen Datang</p>
          <p className="text-3xl font-bold text-emerald-700">{history.filter(r => r.type === 'datang').length}</p>
        </div>
        <div className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100 space-y-2">
          <p className="text-xs font-bold text-zinc-600 uppercase tracking-wider">Absen Pulang</p>
          <p className="text-3xl font-bold text-zinc-900">{history.filter(r => r.type === 'pulang').length}</p>
        </div>
      </div>

      <div className="bg-white rounded-3xl shadow-xl border border-zinc-100 overflow-hidden">
        <div className="p-6 border-b border-zinc-100 flex items-center justify-between bg-zinc-50/50">
          <div className="flex items-center gap-2">
            <FileSpreadsheet className="text-emerald-500" size={20} />
            <h3 className="font-bold text-zinc-900">Rekapitulasi Data</h3>
          </div>
          <button
            onClick={downloadRecapitulation}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold text-sm hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-100"
          >
            <Download size={16} />
            Unduh CSV
          </button>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-zinc-50 text-zinc-400 text-[10px] font-bold uppercase tracking-widest">
                <th className="px-6 py-4">Karyawan</th>
                <th className="px-6 py-4">Tipe</th>
                <th className="px-6 py-4">Waktu & Tanggal</th>
                <th className="px-6 py-4">Lokasi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {history.map((record) => (
                <tr key={record.id} className="hover:bg-zinc-50/50 transition-colors">
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <img src={record.photo} className="w-8 h-8 rounded-lg object-cover border border-zinc-200" />
                      <span className="font-semibold text-sm">{record.employeeName}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md ${record.type === 'datang' ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-100 text-zinc-700'}`}>
                      {record.type.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-bold text-zinc-900">{format(new Date(record.timestamp), 'HH:mm')}</p>
                    <p className="text-[10px] text-zinc-400">{format(new Date(record.timestamp), 'd MMM yyyy')}</p>
                  </td>
                  <td className="px-6 py-4">
                    <a 
                      href={`https://www.google.com/maps?q=${record.location.lat},${record.location.lng}`}
                      target="_blank"
                      className="text-[10px] font-mono text-emerald-600 hover:underline"
                    >
                      {record.location.lat.toFixed(4)}, {record.location.lng.toFixed(4)}
                    </a>
                  </td>
                </tr>
              ))}
              {history.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-zinc-400 italic text-sm">
                    Belum ada data absensi.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#F5F5F7] text-zinc-900 font-sans selection:bg-emerald-100 selection:text-emerald-900">
      {/* Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-50 border-b border-zinc-100 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2 cursor-pointer" onClick={() => setStep('home')}>
            <div className="w-8 h-8 bg-emerald-500 rounded-lg flex items-center justify-center text-white font-bold">A</div>
            <span className="font-bold tracking-tight">ABSENSI</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 mr-4 pr-4 border-r border-zinc-100">
              <button 
                onClick={() => setIsAdmin(!isAdmin)}
                className={`p-2 rounded-xl transition-all ${isAdmin ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'}`}
                title="Toggle Admin Mode"
              >
                <Shield size={18} />
              </button>
              {isAdmin && (
                <button 
                  onClick={() => setStep('admin')}
                  className="px-3 py-1.5 bg-emerald-500 text-white text-xs font-bold rounded-lg hover:bg-emerald-600 transition-all"
                >
                  Admin Panel
                </button>
              )}
            </div>
            <div className="text-right hidden sm:block">
              <p className="text-xs font-bold text-zinc-400 uppercase tracking-widest">{isAdmin ? 'Administrator' : 'Karyawan'}</p>
              <p className="text-sm font-semibold">{isAdmin ? 'Admin DJM' : 'User Demo'}</p>
            </div>
            <div className="w-10 h-10 bg-zinc-100 rounded-full flex items-center justify-center text-zinc-400 border border-zinc-200">
              <User size={20} />
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto pb-20">
        <AnimatePresence mode="wait">
          <motion.div
            key={step}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.2 }}
          >
            {step === 'home' && renderHome()}
            {step === 'name' && renderNameInput()}
            {step === 'camera' && renderCamera()}
            {step === 'location' && renderLocation()}
            {step === 'summary' && renderSummary()}
            {step === 'history' && renderHistory()}
            {step === 'admin' && renderAdmin()}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Footer Info */}
      <footer className="fixed bottom-0 left-0 right-0 p-4 text-center pointer-events-none">
        <div className="bg-white/50 backdrop-blur-sm inline-block px-4 py-2 rounded-full border border-zinc-200/50 shadow-sm">
          <p className="text-[10px] font-bold text-zinc-400 uppercase tracking-[0.2em]">
            {format(new Date(), 'EEEE, d MMMM yyyy', { locale: id })}
          </p>
        </div>
      </footer>
    </div>
  );
}
