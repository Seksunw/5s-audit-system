================================================================================
GOOGLE APPS SCRIPT BACKEND - ADMIN USER MANAGEMENT
实现指南 (Implementation Guide)
================================================================================

Your frontend is ready! Now you need to add these API endpoints to your Google Apps Script.

REQUIRED API ENDPOINTS (5 total)
================================================================================

1. getUsers (GET)
──────────────────────────────────────────────────────────────────────────────
Endpoint: ?action=getUsers&token=...
Purpose: Retrieve all users from Google Sheet

Response Format:
{
  "success": true,
  "data": [
    {
      "userId": "user_001",
      "name": "John Doe",
      "email": "john@company.com",
      "role": "Auditor",
      "status": "active",
      "assignedPlants": "SUP,POC",
      "assignedAreas": "Area1,Area2",
      "createdDate": "2024-01-15",
      "updatedDate": "2024-01-20"
    },
    ...
  ]
}

GAS Implementation Example:
────────────────────────────
function getUsers(e) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = sheet.getDataRange().getValues();
    
    const users = [];
    for (let i = 1; i < data.length; i++) {
      users.push({
        userId: data[i][0],
        name: data[i][1],
        email: data[i][2],
        role: data[i][3],
        status: data[i][4],
        assignedPlants: data[i][5],
        assignedAreas: data[i][6],
        createdDate: data[i][7],
        updatedDate: data[i][8]
      });
    }
    
    return { success: true, data: users };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

Google Sheet Structure:
────────────────────────
Create a sheet named "Users" with these columns:
  Column A: userId (Unique ID - auto-generate or use email)
  Column B: name (User full name)
  Column C: email (User email)
  Column D: role (Auditor, Area Manager, Plant Manager, Admin)
  Column E: status (active/inactive)
  Column F: assignedPlants (Comma-separated Plant IDs: SUP,POC,NIF)
  Column G: assignedAreas (Comma-separated Area IDs)
  Column H: createdDate (YYYY-MM-DD)
  Column I: updatedDate (YYYY-MM-DD)

────────────────────────────────────────────────────────────────────────────

2. createUser (POST)
──────────────────────────────────────────────────────────────────────────────
Endpoint: ?action=createUser&token=...&payload=JSON_STRING
Purpose: Create a new user

Input Payload:
{
  "name": "Jane Smith",
  "email": "jane@company.com",
  "password": "plaintext_password",
  "role": "Auditor",
  "status": "active",
  "assignedPlants": "SUP,POC",
  "assignedAreas": "Area1,Area2"
}

Response:
{
  "success": true,
  "userId": "user_002",
  "message": "User created successfully"
}

GAS Implementation Example:
────────────────────────────
function createUser(payload) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    
    // Validate token (you should verify admin token)
    // ... token validation logic ...
    
    // Generate userId (example: email without domain)
    const userId = payload.email.split('@')[0] + '_' + Date.now();
    
    // Hash password (use suitable library or Utilities.computeDigest)
    const hashedPassword = Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      payload.password
    );
    
    // Append to sheet
    sheet.appendRow([
      userId,
      payload.name,
      payload.email,
      payload.role || 'Auditor',
      payload.status || 'active',
      payload.assignedPlants || '',
      payload.assignedAreas || '',
      new Date().toISOString().split('T')[0],
      new Date().toISOString().split('T')[0]
    ]);
    
    return { 
      success: true, 
      userId: userId,
      message: 'User created successfully'
    };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

────────────────────────────────────────────────────────────────────────────

3. updateUser (POST)
──────────────────────────────────────────────────────────────────────────────
Endpoint: ?action=updateUser&token=...&payload=JSON_STRING
Purpose: Update an existing user

Input Payload:
{
  "userId": "user_001",
  "name": "John Doe Updated",
  "email": "john@company.com",
  "password": "new_password",  // Optional - if not provided, password unchanged
  "role": "Area Manager",
  "status": "active",
  "assignedPlants": "SUP",
  "assignedAreas": "Area1,Area3"
}

Response:
{
  "success": true,
  "message": "User updated successfully"
}

GAS Implementation Example:
────────────────────────────
function updateUser(payload) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = sheet.getDataRange().getValues();
    
    // Find user by userId
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === payload.userId) {
        rowIndex = i + 1; // Sheet row numbers start at 1
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { success: false, error: 'User not found' };
    }
    
    // Update row
    sheet.getRange(rowIndex, 2).setValue(payload.name);
    sheet.getRange(rowIndex, 3).setValue(payload.email);
    sheet.getRange(rowIndex, 4).setValue(payload.role);
    sheet.getRange(rowIndex, 5).setValue(payload.status);
    sheet.getRange(rowIndex, 6).setValue(payload.assignedPlants || '');
    sheet.getRange(rowIndex, 7).setValue(payload.assignedAreas || '');
    sheet.getRange(rowIndex, 9).setValue(new Date().toISOString().split('T')[0]);
    
    // If password provided, update it (hash it first)
    if (payload.password) {
      const hashedPassword = Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        payload.password
      );
      // Store in a separate encrypted sheet or database
      // ... password storage logic ...
    }
    
    return { success: true, message: 'User updated successfully' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

────────────────────────────────────────────────────────────────────────────

4. deleteUser (POST)
──────────────────────────────────────────────────────────────────────────────
Endpoint: ?action=deleteUser&token=...&payload=JSON_STRING
Purpose: Delete (mark as inactive) a user

Input Payload:
{
  "userId": "user_001"
}

Response:
{
  "success": true,
  "message": "User deleted successfully"
}

GAS Implementation Example:
────────────────────────────
function deleteUser(payload) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Users');
    const data = sheet.getDataRange().getValues();
    
    // Find user by userId
    let rowIndex = -1;
    for (let i = 1; i < data.length; i++) {
      if (data[i][0] === payload.userId) {
        rowIndex = i + 1;
        break;
      }
    }
    
    if (rowIndex === -1) {
      return { success: false, error: 'User not found' };
    }
    
    // Mark as inactive instead of deleting
    sheet.getRange(rowIndex, 5).setValue('inactive');
    sheet.getRange(rowIndex, 9).setValue(new Date().toISOString().split('T')[0]);
    
    return { success: true, message: 'User deleted successfully' };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

────────────────────────────────────────────────────────────────────────────

5. Modify existing endpoint: update login to include user role check
──────────────────────────────────────────────────────────────────────────────
When user logs in, return role in user object:

{
  "success": true,
  "token": "...",
  "user": {
    "userId": "user_001",
    "name": "John Doe",
    "email": "john@company.com",
    "role": "Admin"  // ← IMPORTANT: Make sure role is returned
  }
}

================================================================================
INTEGRATION STEPS IN GOOGLE APPS SCRIPT
================================================================================

1. Open your Google Apps Script project
2. Add a new function to route actions (already should exist):

   function doGet(e) {
     const action = e.parameter.action;
     const token = e.parameter.token || '';
     
     // Verify token before processing
     if (!token && action !== 'login') {
       return ContentService.createTextOutput(
         JSON.stringify({ success: false, error: 'Missing token' })
       ).setMimeType(ContentService.MimeType.JSON);
     }
     
     // Route to appropriate handler
     switch(action) {
       case 'login':
         return ContentService.createTextOutput(
           JSON.stringify(login(JSON.parse(e.parameter.payload)))
         ).setMimeType(ContentService.MimeType.JSON);
       
       case 'getUsers':
         return ContentService.createTextOutput(
           JSON.stringify(getUsers(e))
         ).setMimeType(ContentService.MimeType.JSON);
       
       // ... existing endpoints ...
       
       default:
         return ContentService.createTextOutput(
           JSON.stringify({ success: false, error: 'Unknown action' })
         ).setMimeType(ContentService.MimeType.JSON);
     }
   }

3. For POST requests, also implement doPost():

   function doPost(e) {
     return doGet(e);  // Forward to doGet for same handling
   }

4. Deploy as Web App (should already be done):
   - Project Settings → Web App → Deploy as executable
   - Execute as: Your account
   - Allow: Anyone

================================================================================
TESTING THE API ENDPOINTS
================================================================================

Test createUser:
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?action=createUser&token=admin_token&payload=%7B%22name%22%3A%22Test%20User%22%2C%22email%22%3A%22test%40test.com%22%2C%22password%22%3A%22test123%22%2C%22role%22%3A%22Auditor%22%7D"

Test getUsers:
curl "https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?action=getUsers&token=admin_token"

================================================================================
IMPORTANT SECURITY NOTES
================================================================================

1. Always verify token before processing any request
2. Only allow Admin users to access user management endpoints
3. Hash passwords before storing (use SHA-256 or bcrypt)
4. Don't send plain text passwords back to frontend
5. Use HTTPS only (Google Apps Script provides this automatically)
6. Implement rate limiting to prevent brute force attacks
7. Log all admin actions for audit trail

================================================================================
Next Steps After Backend Implementation
================================================================================

1. Test all CRUD operations in the admin panel
2. Verify Google Sheet updates in real-time
3. Test with non-admin users (should be redirected)
4. Check plant/area assignments are saved correctly
5. Verify inactive users cannot login
6. Test edge cases (duplicate email, special characters, etc.)

================================================================================
Frontend is COMPLETE! 
Backend implementation is your next step.

Files modified:
- ✅ Created: admin.html (126 lines)
- ✅ Updated: js/app.js (+420 lines for admin functions)
- ✅ Updated: css/style.css (+130 lines for modal & admin styles)
- ✅ Updated: All 8 HTML pages (added admin nav link)

Ready to deploy when backend endpoints are ready!
================================================================================
