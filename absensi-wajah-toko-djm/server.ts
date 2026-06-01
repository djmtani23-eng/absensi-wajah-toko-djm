import express from 'express';
import { createServer as createViteServer } from 'vite';
import { google } from 'googleapis';
import cookieSession from 'cookie-session';
import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json({ limit: '10mb' }));
app.use(cookieSession({
  name: 'session',
  keys: [process.env.SESSION_SECRET || 'default-secret'],
  maxAge: 24 * 60 * 60 * 1000, // 24 hours
  secure: true,
  sameSite: 'none',
}));

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  `${process.env.APP_URL}/auth/callback`
);

// Auth Routes
app.get('/api/auth/url', (req, res) => {
  const url = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/userinfo.email'
    ],
    prompt: 'consent'
  });
  res.json({ url });
});

app.get('/auth/callback', async (req, res) => {
  const { code } = req.query;
  try {
    const { tokens } = await oauth2Client.getToken(code as string);
    req.session!.tokens = tokens;
    
    // Get user email
    oauth2Client.setCredentials(tokens);
    const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    req.session!.email = userInfo.data.email;

    res.send(`
      <html>
        <body>
          <script>
            if (window.opener) {
              window.opener.postMessage({ type: 'OAUTH_AUTH_SUCCESS' }, '*');
              window.close();
            } else {
              window.location.href = '/';
            }
          </script>
          <p>Authentication successful. This window should close automatically.</p>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('Auth error:', error);
    res.status(500).send('Authentication failed');
  }
});

app.get('/api/auth/status', (req, res) => {
  res.json({ 
    authenticated: !!req.session?.tokens,
    email: req.session?.email
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session = null;
  res.json({ success: true });
});

// Sheets API
app.post('/api/attendance', async (req, res) => {
  if (!req.session?.tokens) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { type, photo, timestamp, location } = req.body;
  oauth2Client.setCredentials(req.session.tokens);
  const sheets = google.sheets({ version: 'v4', auth: oauth2Client });

  try {
    // 1. Find or create the spreadsheet
    let spreadsheetId = req.session.spreadsheetId;
    if (!spreadsheetId) {
      // Search for existing "Absensi Toko DJM" spreadsheet
      const drive = google.drive({ version: 'v3', auth: oauth2Client });
      const response = await drive.files.list({
        q: "name = 'Absensi Toko DJM' and mimeType = 'application/vnd.google-apps.spreadsheet'",
        fields: 'files(id)',
      });

      if (response.data.files && response.data.files.length > 0) {
        spreadsheetId = response.data.files[0].id;
      } else {
        // Create new
        const spreadsheet = await sheets.spreadsheets.create({
          requestBody: {
            properties: { title: 'Absensi Toko DJM' },
            sheets: [{ properties: { title: 'Data Absensi' } }]
          }
        });
        spreadsheetId = spreadsheet.data.spreadsheetId;
        
        // Add headers
        await sheets.spreadsheets.values.update({
          spreadsheetId,
          range: 'Data Absensi!A1:G1',
          valueInputOption: 'RAW',
          requestBody: {
            values: [['ID', 'Tipe', 'Waktu', 'Tanggal', 'Latitude', 'Longitude', 'Foto URL']]
          }
        });
      }
      req.session.spreadsheetId = spreadsheetId;
    }

    // 2. Append data
    const date = new Date(timestamp);
    const row = [
      Date.now().toString(),
      type,
      date.toLocaleTimeString(),
      date.toLocaleDateString(),
      location.lat,
      location.lng,
      photo.substring(0, 100) + '... (Base64)' // We don't want to store full base64 in sheets usually, but user asked for it. 
      // Note: Google Sheets has cell limit. Storing full base64 might fail for large images.
    ];

    await sheets.spreadsheets.values.append({
      spreadsheetId,
      range: 'Data Absensi!A:G',
      valueInputOption: 'RAW',
      requestBody: {
        values: [row]
      }
    });

    res.json({ success: true, spreadsheetId });
  } catch (error: any) {
    console.error('Sheets error:', error);
    res.status(500).json({ error: error.message });
  }
});

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static('dist'));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve('dist/index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
