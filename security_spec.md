# Security Specification: Employee Attendance Application

This document specifies the security requirements and invariants for the employee attendance collection stored in Firestore.

---

## 1. Data Invariants

- **Immutability After Submission**: Once an attendance record is created, it **MUST NOT** be modified or deleted. Only creation and reading are permitted to prevent tampering of historical records.
- **Strict Schema Enforcement**: Every document in the `attendance` collection must contain exactly the required fields: `id`, `employeeName`, `type` (either `'datang'` or `'pulang'`), `photo` (Base64 data url), `timestamp`, and `location` containing numeric `lat` and `lng`.
- **String Field Boundaries**: String field sizes must be reasonably limited (e.g., `employeeName` <= 150 characters, `photo` <= 850,000 characters) to prevent Denial of Wallet storage exhaustion attacks.

---

## 2. The "Dirty Dozen" Payloads

Here are 12 specific payloads representing threat vectors designed to compromise the database, and verify they will be blocked by our Firestore rules.

1. **Attempting to Delete an Entry**  
   *Target action*: `DELETE /attendance/1234`  
   *Result*: `PERMISSION_DENIED`

2. **Attempting to Edit/Update an Entry**  
   *Target action*: `UPDATE /attendance/1234`  
   *Result*: `PERMISSION_DENIED` (Strictly immutable)

3. **Missing Mandatory Name Field**  
   *Target action*: `CREATE` with payload missing `employeeName`.  
   *Result*: `PERMISSION_DENIED`

4. **Invalid Sesi Type Field**  
   *Target action*: `CREATE` with `type` = `"istirahat"` instead of `"datang"` or `"pulang"`.  
   *Result*: `PERMISSION_DENIED`

5. **Exorbitantly Long Name Strings (Denial of Wallet)**  
   *Target action*: `CREATE` with `employeeName` of 1 megabyte size.  
   *Result*: `PERMISSION_DENIED`

6. **Missing Location Coordinates**  
   *Target action*: `CREATE` with `location` lacking `lat` or `lng`.  
   *Result*: `PERMISSION_DENIED`

7. **Invalid Location Coordinates Format**  
   *Target action*: `CREATE` where `lat` is a string value `"not-a-number"`.  
   *Result*: `PERMISSION_DENIED`

8. **Missing Selfie Photo Field**  
   *Target action*: `CREATE` with `photo` field missing entirely.  
   *Result*: `PERMISSION_DENIED`

9. **Photo Field value has invalid type**  
   *Target action*: `CREATE` where `photo` is a boolean `true` instead of a base64 string.  
   *Result*: `PERMISSION_DENIED`

10. **Shadow Key Insertion Attempt**  
    *Target action*: `CREATE` with payload containing unauthorized additional fields (such as `isVerifiedOnlyByAdmin: true`).  
    *Result*: `PERMISSION_DENIED`

11. **ID Poisoning Attack**  
    *Target action*: `CREATE` using a document ID with forbidden special characters or extremely long size.  
    *Result*: `PERMISSION_DENIED`

12. **Missing ID Field inside Payload**  
    *Target action*: `CREATE` where payload does not match the URL ID key.  
    *Result*: `PERMISSION_DENIED`
