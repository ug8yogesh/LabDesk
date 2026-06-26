const express = require('express');
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const session = require('express-session');
const path = require('path');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const loginAttempts = {};
const BLOCK_TIME = 15 * 60 * 1000; // 15 minutes
const nodemailer = require("nodemailer");
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});


// ─── MYSQL CONNECTION POOL ────────────────────────────────────────────────────
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'lab_fault_system',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
});

const db = {
  async query(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows;
  },
  async get(sql, params = []) {
    const [rows] = await pool.execute(sql, params);
    return rows[0] || null;
  }
};

app.use(express.json({ limit: '50kb' })); // FIX: Limit request body size to prevent large payload attacks
app.use(express.static(path.join(__dirname, 'public')));

// FIX: Session secret must come from environment variable, not be hardcoded
if (!process.env.SESSION_SECRET) {
  console.warn('⚠️  WARNING: SESSION_SECRET is not set in .env — using an insecure fallback. Set it before going to production.');
}
app.set('trust proxy', 1); // Trust Render's proxy for secure cookies
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-fallback-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production', // FIX: Only force HTTPS in production
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 30 * 60 * 1000 // 30 minutes
  }
}));

// FIX: Periodically clean up stale loginAttempts entries to prevent unbounded memory growth.
// Runs every 30 minutes and removes entries older than BLOCK_TIME.
setInterval(() => {
  const now = Date.now();
  for (const ip in loginAttempts) {
    if (now - loginAttempts[ip].lastAttempt > BLOCK_TIME) {
      delete loginAttempts[ip];
    }
  }
}, 30 * 60 * 1000);

// ─── INPUT LENGTH LIMITS ──────────────────────────────────────────────────────
const MAX_LENGTHS = {
  name: 100,
  email: 150,
  password: 10,   // Max 10 per password rules
  student_id: 30,
  lab_name: 100,
  computer_number: 20,
  description: 2000,
  comment: 1000,
  category: 100,
  problem: 300,
  solution: 300,
};

function validateLengths(fields, res) {
  for (const [key, val] of Object.entries(fields)) {
    if (val && MAX_LENGTHS[key] && String(val).length > MAX_LENGTHS[key]) {
      res.status(400).json({ error: `${key} is too long (max ${MAX_LENGTHS[key]} characters)` });
      return false;
    }
  }
  return true;
}

// ─── PASSWORD VALIDATION ──────────────────────────────────────────────────────
const COMMON_PASSWORDS = [
  'password', '12345678', '123456789', 'password1', 'iloveyou',
  'admin123', 'welcome1', 'monkey123', 'dragon12', 'master12',
  'letmein1', 'sunshine', 'princess', 'football', 'qwerty123'
];

function validatePassword(password, name, studentId) {
  name = name || '';
  studentId = studentId || '';
  const errors = [];

  // Rule 6: No leading/trailing spaces
  if (password !== password.trim()) {
    errors.push('Password must not start or end with a space.');
  }

  const pw = password.trim();

  // Rule 1: Length 8-10
  if (pw.length < 8 || pw.length > 10) {
    errors.push('Password must be between 8 and 10 characters long.');
  }

  // Rule 2: Uppercase
  if (!/[A-Z]/.test(pw)) {
    errors.push('Password must include at least one uppercase letter (A-Z).');
  }

  // Rule 3: Lowercase
  if (!/[a-z]/.test(pw)) {
    errors.push('Password must include at least one lowercase letter (a-z).');
  }

  // Rule 4: Digit
  if (!/[0-9]/.test(pw)) {
    errors.push('Password must include at least one numeric digit (0-9).');
  }

  // Rule 5: Special character
  if (!/[@#$%&*!^()_\-+=\[\]{};:'",.<>?/\\|`~]/.test(pw)) {
    errors.push('Password must include at least one special character (e.g. @, #, $, %, &, *).');
  }

  // Rule 7: Common passwords
  if (COMMON_PASSWORDS.includes(pw.toLowerCase())) {
    errors.push('Password is too common. Please choose a more unique password.');
  }

  // Rule 8: No personal info
  const lowerPw = pw.toLowerCase();
  const nameParts = name.toLowerCase().split(/\s+/).filter(function(p) { return p.length > 2; });
  for (let i = 0; i < nameParts.length; i++) {
    if (lowerPw.includes(nameParts[i])) {
      errors.push('Password must not contain your name.');
      break;
    }
  }
  if (studentId && lowerPw.includes(studentId.toLowerCase())) {
    errors.push('Password must not contain your Student ID.');
  }

  // Rule 9: No more than 2 consecutive identical characters
  if (/(.)\1{2,}/.test(pw)) {
    errors.push('Password must not have more than 2 consecutive identical characters (e.g. "aaa").');
  }

  return errors;
}

// ─── SEED DATA ────────────────────────────────────────────────────────────────
const seedUsers = async () => {
  const row = await db.get('SELECT COUNT(*) as c FROM users');
  if (row.c == 0) {
    const hash = (pwd) => bcrypt.hashSync(pwd, 10);
    await db.query('INSERT INTO users (name, email, password, role, student_id) VALUES (?,?,?,?,?)', ['Admin User', 'admin@lab.com', hash('admin123'), 'admin', null]);
    await db.query('INSERT INTO users (name, email, password, role, student_id) VALUES (?,?,?,?,?)', ['John Student', 'student@lab.com', hash('student123'), 'student', 'STU001']);
    await db.query('INSERT INTO users (name, email, password, role, student_id) VALUES (?,?,?,?,?)', ['Tech Kumar', 'tech@lab.com', hash('tech123'), 'technician', null]);
    await db.query('INSERT INTO users (name, email, password, role, student_id) VALUES (?,?,?,?,?)', ['Tech Priya', 'tech2@lab.com', hash('tech123'), 'technician', null]);
    console.log('✅ Default users seeded');
  }
};

const seedSolutions = async () => {
  const row = await db.get('SELECT COUNT(*) as c FROM software_solutions');
  if (row.c == 0) {
    const solutions = [
      ['Application Issues', 'Application not installed / missing', 'Install the required application', JSON.stringify(['Click Start Menu and search for the application','If not found, open Software Center or App Store','Search for the required application','Click Install and wait for completion','Restart the application if needed','Contact admin if installation fails'])],
      ['Application Issues', 'Application crashes or freezes', 'Force close and restart the application', JSON.stringify(['Press Ctrl + Alt + Delete and open Task Manager','Find the frozen application in the list','Right-click and select End Task','Wait 30 seconds then reopen the application','If it crashes again, try restarting the computer','Report to admin if problem persists'])],
      ['Internet & Network', 'No internet connection', 'Check network settings and reconnect', JSON.stringify(['Check if the network cable is properly plugged in','Click the network icon in the taskbar','Select your network and click Connect','If Wi-Fi, enter the password if prompted','Open browser and test the connection','Restart the computer if still not connected'])],
      ['Internet & Network', 'Slow internet or browser issues', 'Clear cache and restart browser', JSON.stringify(['Press Ctrl + Shift + Delete in your browser','Select All time for the time range','Check all boxes for cache cookies history','Click Clear data or Clear browsing data','Close and reopen the browser','Try a different browser if issue continues'])],
      ['Display & Graphics', 'Screen resolution is wrong', 'Adjust display settings', JSON.stringify(['Right-click on the desktop','Select Display Settings','Scroll to Display Resolution','Select the recommended resolution','Click Keep Changes when prompted','Restart if the issue persists'])],
      ['Display & Graphics', 'Screen flickers or has artifacts', 'Update or roll back display driver', JSON.stringify(['Right-click Start Menu and select Device Manager','Expand Display Adapters','Right-click your graphics card','Select Update driver then Search automatically','If it worsens select Roll Back Driver','Restart the computer after changes'])],
      ['File & Storage', 'Cannot save files or disk full', 'Free up disk space', JSON.stringify(['Open File Explorer and right-click on C drive','Select Properties to see disk space','Open Disk Cleanup from the same screen','Check all boxes and click OK','Delete any personal unused files from Desktop','Contact admin if system drive is full'])],
      ['File & Storage', 'USB drive not recognized', 'Reconnect and check device manager', JSON.stringify(['Remove the USB drive and reinsert it','Wait 10 seconds for it to be detected','Open File Explorer to check if it appears','If not open Device Manager and look for errors','Try a different USB port on the computer','Test the USB on another computer to confirm it works'])],
      ['System Performance', 'Computer is very slow', 'Close background processes and clean up', JSON.stringify(['Press Ctrl + Alt + Delete and open Task Manager','Sort by CPU and Memory usage','End any unnecessary high-usage processes','Disable startup programs via Task Manager Startup tab','Run Disk Cleanup from Start Menu','Restart the computer'])],
      ['System Performance', 'Computer wont start or boot loop', 'Perform startup repair', JSON.stringify(['Hold the power button to force shutdown','Press F8 or F11 repeatedly while turning on','Select Startup Repair from the options','Let Windows diagnose and fix the issue','If it fails select System Restore','Contact admin or technician if repair fails'])],
      ['Printing', 'Cannot print or printer offline', 'Restart print spooler service', JSON.stringify(['Press Windows + R and type services.msc','Find Print Spooler service','Right-click and select Restart','Open Control Panel and go to Printers','Right-click your printer and Set as Default','Try printing again'])],
      ['Login & Access', 'Forgot password or cannot login', 'Contact administrator to reset password', JSON.stringify(['Do NOT try too many incorrect passwords','Note your Student ID and username','Visit the admin office or raise a ticket','Admin will reset your password','Check your email for reset instructions','Login with temporary password and change it'])],
    ];
    for (const s of solutions) {
      await db.query('INSERT INTO software_solutions (category, problem, solution, steps) VALUES (?,?,?,?)', s);
    }
    console.log('✅ Software solutions seeded');
  }
};

// ─── AUTH MIDDLEWARE ──────────────────────────────────────────────────────────
const requireAuth = (role) => (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  if (role && req.session.user.role !== role) return res.status(403).json({ error: 'Forbidden' });
  next();
};
const requireAnyAuth = (req, res, next) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  next();
};

// ─── AUTH ROUTES ──────────────────────────────────────────────────────────────
app.post('/api/auth/login', async (req, res) => {
  const ip = req.headers['x-forwarded-for'] || req.ip;

  if (loginAttempts[ip] && loginAttempts[ip].count >= 5) {
    if (Date.now() - loginAttempts[ip].lastAttempt < BLOCK_TIME) {
      return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
    } else {
      loginAttempts[ip] = { count: 0, lastAttempt: Date.now() };
    }
  }

  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);
    if (!user) {
      loginAttempts[ip] = { count: (loginAttempts[ip]?.count || 0) + 1, lastAttempt: Date.now() };
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      loginAttempts[ip] = { count: (loginAttempts[ip]?.count || 0) + 1, lastAttempt: Date.now() };
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    req.session.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      student_id: user.student_id
    };
    loginAttempts[ip] = { count: 0, lastAttempt: Date.now() };
    res.json({ user: req.session.user });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  try {
    const { name, email, password, student_id } = req.body;
    if (!name || !email || !password || !student_id)
      return res.status(400).json({ error: 'All fields required' });

    // Validate field lengths
    if (!validateLengths({ name, email, student_id }, res)) return;

    // Backend password validation — all 10 rules
    const pwErrors = validatePassword(password, name, student_id);
    if (pwErrors.length > 0) {
      return res.status(400).json({ error: pwErrors.join(' | ') });
    }

    const existing = await db.get('SELECT id FROM users WHERE email = ?', [email]);
    if (existing) return res.status(400).json({ error: 'Email already registered' });

    const hashed = bcrypt.hashSync(password, 10);
    await db.query('INSERT INTO users (name, email, password, role, student_id) VALUES (?,?,?,?,?)', [name, email, hashed, 'student', student_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/auth/logout', (req, res) => { req.session.destroy(); res.json({ success: true }); });

app.get('/api/auth/me', (req, res) => {
  if (!req.session.user) return res.status(401).json({ error: 'Not authenticated' });
  res.json({ user: req.session.user });
});

// ─── FORGOT / RESET PASSWORD ─────────────────────────────────────────────────
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });

    const user = await db.get('SELECT * FROM users WHERE email = ?', [email]);

    // Prevent user enumeration
    if (!user) {
      return res.json({ message: 'If that email exists, a reset link has been sent.' });
    }

    const token = crypto.randomBytes(32).toString('hex');
    const expiry = Date.now() + (15 * 60 * 1000); // 15 minutes

    // Save token in DB
    try {
      await db.query(
        'UPDATE users SET reset_token=?, reset_token_expiry=? WHERE id=?',
        [token, expiry, user.id]
      );
    } catch (dbErr) {
      console.error('⚠️ DB ERROR:', dbErr.message);
      return res.status(500).json({ error: 'Password reset not configured' });
    }

    const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const resetLink = `${baseUrl}/frontend/reset-password.html?token=${token}`;
    // ✅ ADD THIS TRY-CATCH (IMPORTANT)
    try {
      await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: user.email,
        subject: "Password Reset",
        html: `
          <h3>Password Reset Request</h3>
          <p>Click the link below to reset your password:</p>
          <a href="${resetLink}">${resetLink}</a>
          <p>This link will expire in 15 minutes.</p>
        `
      });

      console.log("✅ Email sent to:", user.email);

    } catch (mailError) {
      console.error("❌ MAIL ERROR:", mailError);
      return res.status(500).json({ error: 'Failed to send email' });
    }

    res.json({ message: 'If that email exists, a reset link has been sent.' });

  } catch (e) {
    console.error("❌ SERVER ERROR:", e.message);
    res.status(500).json({ error: e.message });
  }
});
app.post('/api/auth/reset-password', async (req, res) => {
  try {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });

    // Apply full password rules on reset too
    const pwErrors = validatePassword(newPassword);
    if (pwErrors.length > 0) {
      return res.status(400).json({ error: pwErrors.join(' | ') });
    }

    const user = await db.get('SELECT * FROM users WHERE reset_token = ?', [token]);
    if (!user) return res.status(400).json({ error: 'Invalid or expired reset link' });
    if (Date.now() > user.reset_token_expiry) return res.status(400).json({ error: 'Reset link has expired. Please request a new one.' });

    const hashedPassword = bcrypt.hashSync(newPassword, 10);
    await db.query(
      'UPDATE users SET password=?, reset_token=NULL, reset_token_expiry=NULL WHERE id=?',
      [hashedPassword, user.id]
    );

    res.json({ message: 'Password reset successful. You can now sign in.' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── SOFTWARE SOLUTIONS ───────────────────────────────────────────────────────
app.get('/api/solutions', requireAnyAuth, async (req, res) => {
  try { res.json(await db.query('SELECT * FROM software_solutions ORDER BY category, problem')); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/solutions', requireAuth('admin'), async (req, res) => {
  try {
    const { category, problem, solution, steps } = req.body;
    if (!category || !problem || !solution || !steps) return res.status(400).json({ error: 'All fields required' });
    if (!validateLengths({ category, problem, solution }, res)) return;
    await db.query('INSERT INTO software_solutions (category, problem, solution, steps) VALUES (?,?,?,?)', [category, problem, solution, steps]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.put('/api/admin/solutions/:id', requireAuth('admin'), async (req, res) => {
  try {
    const { category, problem, solution, steps } = req.body;
    if (!category || !problem || !solution || !steps) return res.status(400).json({ error: 'All fields required' });
    if (!validateLengths({ category, problem, solution }, res)) return;
    await db.query('UPDATE software_solutions SET category=?, problem=?, solution=?, steps=? WHERE id=?', [category, problem, solution, steps, req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/solutions/:id', requireAuth('admin'), async (req, res) => {
  try {
    await db.query('DELETE FROM software_solutions WHERE id=?', [req.params.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── FAULT REPORTS ────────────────────────────────────────────────────────────
app.post('/api/faults', requireAuth('student'), async (req, res) => {
  try {
    const { lab_name, computer_number, fault_type, description } = req.body;
    if (!lab_name || !computer_number || !fault_type || !description)
      return res.status(400).json({ error: 'All fields required' });

    // FIX: Validate allowed fault types to prevent arbitrary values entering DB
    if (!['hardware', 'software'].includes(fault_type))
      return res.status(400).json({ error: 'Invalid fault type' });

    // FIX: Validate field lengths
    if (!validateLengths({ lab_name, computer_number, description }, res)) return;

    const [result] = await pool.execute(
      'INSERT INTO fault_reports (student_id, lab_name, computer_number, fault_type, description) VALUES (?,?,?,?,?)',
      [req.session.user.id, lab_name, computer_number, fault_type, description]
    );

    if (fault_type === 'hardware') {
      const admins = await db.query("SELECT id FROM users WHERE role='admin'");
      for (const admin of admins) {
        await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)',
          [admin.id, `🔧 New hardware fault at ${lab_name} - PC ${computer_number} by ${req.session.user.name}`, 'hardware']);
      }
    }

    res.json({ success: true, fault_id: result.insertId });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/faults/my', requireAuth('student'), async (req, res) => {
  try { res.json(await db.query('SELECT * FROM fault_reports WHERE student_id = ? ORDER BY created_at DESC', [req.session.user.id])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/faults/:id/self-resolved', requireAuth('student'), async (req, res) => {
  try {
    await db.query("UPDATE fault_reports SET status='closed', resolved_by_student=1, updated_at=NOW() WHERE id=? AND student_id=?", [req.params.id, req.session.user.id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/faults', requireAuth('admin'), async (req, res) => {
  try {
    const { status, fault_type, search } = req.query;
    let sql = `SELECT fr.*, u.name as student_name, u.student_id as student_number, u2.name as technician_name
      FROM fault_reports fr JOIN users u ON fr.student_id = u.id LEFT JOIN users u2 ON fr.assigned_technician_id = u2.id
      WHERE 1=1`;
    const params = [];
    if (status) { sql += ' AND fr.status = ?'; params.push(status); }
    if (fault_type) { sql += ' AND fr.fault_type = ?'; params.push(fault_type); }
    if (search) { sql += ' AND (fr.description LIKE ? OR fr.lab_name LIKE ? OR u.name LIKE ?)'; const s = `%${search}%`; params.push(s, s, s); }
    sql += ' ORDER BY fr.created_at DESC';
    res.json(await db.query(sql, params));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/technicians', requireAuth('admin'), async (req, res) => {
  try {
    const techs = await db.query("SELECT u.id, u.name, u.email, COUNT(tt.id) as total_tasks, SUM(CASE WHEN tt.status='completed' THEN 1 ELSE 0 END) as completed_tasks FROM users u LEFT JOIN technician_tasks tt ON u.id = tt.technician_id WHERE u.role='technician' GROUP BY u.id");
    res.json(techs);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/assign', requireAuth('admin'), async (req, res) => {
  try {
    const { fault_id, technician_id } = req.body;
    if (!fault_id || !technician_id) return res.status(400).json({ error: 'fault_id and technician_id are required' });

    await db.query("UPDATE fault_reports SET assigned_technician_id=?, status='assigned', updated_at=NOW() WHERE id=?", [technician_id, fault_id]);
    await db.query("INSERT INTO technician_tasks (fault_id, technician_id, assigned_by) VALUES (?,?,?)", [fault_id, technician_id, req.session.user.id]);

    const fault = await db.get('SELECT * FROM fault_reports WHERE id=?', [fault_id]);
    // FIX: Removed unused `tech` variable query — was a dead DB call

    await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)',
      [technician_id, `📋 You have been assigned a new ${fault.fault_type} fault at ${fault.lab_name} - PC ${fault.computer_number}`, 'assignment']);

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/notify-student', requireAuth('admin'), async (req, res) => {
  try {
    const { fault_id } = req.body;
    if (!fault_id) return res.status(400).json({ error: 'fault_id is required' });

    const fault = await db.get('SELECT * FROM fault_reports WHERE id=?', [fault_id]);
    if (!fault) return res.status(404).json({ error: 'Fault not found' });

    await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)',
      [fault.student_id, `✅ Your fault report (#${fault_id}) has been resolved. Please provide your feedback!`, 'resolved']);
    await db.query("UPDATE fault_reports SET status='closed', updated_at=NOW() WHERE id=?", [fault_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/technician/tasks', requireAuth('technician'), async (req, res) => {
  try {
    res.json(await db.query(`SELECT tt.*, fr.lab_name, fr.computer_number, fr.description, fr.fault_type,
      u.name as student_name, u.student_id as student_number
      FROM technician_tasks tt JOIN fault_reports fr ON tt.fault_id = fr.id JOIN users u ON fr.student_id = u.id
      WHERE tt.technician_id = ? ORDER BY tt.assigned_at DESC`, [req.session.user.id]));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/technician/tasks/:id', requireAuth('technician'), async (req, res) => {
  try {
    const { status, problem_description, solution_description } = req.body;

    // FIX: Validate status to only allow known values — prevents arbitrary status strings
    const ALLOWED_STATUSES = ['accepted', 'declined', 'completed'];
    if (!ALLOWED_STATUSES.includes(status)) {
      return res.status(400).json({ error: `Invalid status. Must be one of: ${ALLOWED_STATUSES.join(', ')}` });
    }

    const task = await db.get('SELECT * FROM technician_tasks WHERE id=? AND technician_id=?', [req.params.id, req.session.user.id]);
    if (!task) return res.status(404).json({ error: 'Task not found' });

    await db.query("UPDATE technician_tasks SET status=?, problem_description=?, solution_description=?, updated_at=NOW() WHERE id=?",
      [status, problem_description || task.problem_description, solution_description || task.solution_description, req.params.id]);

    const admins = await db.query("SELECT id FROM users WHERE role='admin'");

    if (status === 'accepted') {
      await db.query("UPDATE fault_reports SET status='in_progress', updated_at=NOW() WHERE id=?", [task.fault_id]);
      for (const a of admins) await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)', [a.id, `✅ Technician ${req.session.user.name} accepted task for fault #${task.fault_id}`, 'info']);
    } else if (status === 'declined') {
      await db.query("UPDATE fault_reports SET status='open', assigned_technician_id=NULL, updated_at=NOW() WHERE id=?", [task.fault_id]);
      for (const a of admins) await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)', [a.id, `⚠️ Technician ${req.session.user.name} declined task for fault #${task.fault_id}`, 'warning']);
    } else if (status === 'completed') {
      await db.query("UPDATE fault_reports SET status='resolved', resolution_notes=?, updated_at=NOW() WHERE id=?", [solution_description, task.fault_id]);
      for (const a of admins) await db.query('INSERT INTO notifications (user_id, message, type) VALUES (?,?,?)', [a.id, `🎉 Technician ${req.session.user.name} completed fault #${task.fault_id}. Please notify the student.`, 'success']);
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/notifications', requireAnyAuth, async (req, res) => {
  try { res.json(await db.query('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 20', [req.session.user.id])); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.patch('/api/notifications/read', requireAnyAuth, async (req, res) => {
  try { await db.query('UPDATE notifications SET is_read=1 WHERE user_id=?', [req.session.user.id]); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/feedback', requireAuth('student'), async (req, res) => {
  try {
    const { fault_id, rating, comment } = req.body;
    if (!fault_id || !rating) return res.status(400).json({ error: 'fault_id and rating are required' });

    // FIX: Validate rating range
    if (rating < 1 || rating > 5 || !Number.isInteger(Number(rating)))
      return res.status(400).json({ error: 'Rating must be an integer between 1 and 5' });

    // FIX: Validate comment length
    if (comment && !validateLengths({ comment }, res)) return;

    await db.query('INSERT INTO feedback (fault_id, student_id, rating, comment) VALUES (?,?,?,?)', [fault_id, req.session.user.id, rating, comment]);
    await db.query('UPDATE fault_reports SET resolved_by_student=1 WHERE id=?', [fault_id]);
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/feedback', requireAuth('admin'), async (req, res) => {
  try {
    res.json(await db.query(`SELECT f.*, u.name as student_name, fr.lab_name, fr.computer_number
      FROM feedback f JOIN users u ON f.student_id=u.id JOIN fault_reports fr ON f.fault_id=fr.id
      ORDER BY f.created_at DESC`));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/stats', requireAuth('admin'), async (req, res) => {
  try {
    const total = (await db.get('SELECT COUNT(*) as c FROM fault_reports')).c;
    const open = (await db.get("SELECT COUNT(*) as c FROM fault_reports WHERE status='open'")).c;
    const inProgress = (await db.get("SELECT COUNT(*) as c FROM fault_reports WHERE status IN ('assigned','in_progress')")).c;
    const resolved = (await db.get("SELECT COUNT(*) as c FROM fault_reports WHERE status IN ('resolved','closed')")).c;
    const hardware = (await db.get("SELECT COUNT(*) as c FROM fault_reports WHERE fault_type='hardware'")).c;
    const software = (await db.get("SELECT COUNT(*) as c FROM fault_reports WHERE fault_type='software'")).c;
    const avgRating = (await db.get("SELECT AVG(rating) as avg FROM feedback")).avg;
    const todayFaults = (await db.get("SELECT COUNT(*) as c FROM fault_reports WHERE DATE(created_at)=CURDATE()")).c;
    const trend = await db.query("SELECT DATE(created_at) as date, COUNT(*) as count FROM fault_reports WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) GROUP BY DATE(created_at) ORDER BY date");
    const topLabs = await db.query("SELECT lab_name, COUNT(*) as count FROM fault_reports GROUP BY lab_name ORDER BY count DESC LIMIT 5");
    res.json({ total, open, inProgress, resolved, hardware, software, avgRating: avgRating ? parseFloat(avgRating).toFixed(1) : null, todayFaults, trend, topLabs });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── DATABASE VIEWER ──────────────────────────────────────────────────────────
// FIX: Use a safe map instead of string concatenation to build the table query
const ALLOWED_DB_TABLES = {
  users: 'users',
  fault_reports: 'fault_reports',
  technician_tasks: 'technician_tasks',
  software_solutions: 'software_solutions',
  notifications: 'notifications',
  feedback: 'feedback',
};

app.get('/api/admin/db/:table', requireAuth('admin'), async (req, res) => {
  const safeTable = ALLOWED_DB_TABLES[req.params.table];
  if (!safeTable) return res.status(400).json({ error: 'Invalid table name' });
  try {
    const rows = await db.query(`SELECT * FROM \`${safeTable}\` ORDER BY id DESC LIMIT 200`);
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── EXPORT CSV ───────────────────────────────────────────────────────────────
app.get('/api/admin/export/faults', requireAuth('admin'), async (req, res) => {
  try {
    const faults = await db.query(`SELECT fr.id, fr.lab_name, fr.computer_number, fr.fault_type, fr.status, fr.description, u.name as student_name, u.student_id, u2.name as technician_name, fr.created_at, fr.updated_at FROM fault_reports fr JOIN users u ON fr.student_id=u.id LEFT JOIN users u2 ON fr.assigned_technician_id=u2.id ORDER BY fr.created_at DESC`);
    const headers = ['ID','Lab','Computer','Type','Status','Description','Student','Student ID','Technician','Created','Updated'];
    // FIX: Sanitize all string fields for CSV — remove double-quotes AND newlines/carriage
    // returns which would break row structure
    const sanitizeCSV = (val) => String(val || '').replace(/"/g, '""').replace(/[\r\n]+/g, ' ');
    const csv = [
      headers.join(','),
      ...faults.map(f => [
        f.id,
        `"${sanitizeCSV(f.lab_name)}"`,
        `"${sanitizeCSV(f.computer_number)}"`,
        f.fault_type,
        f.status,
        `"${sanitizeCSV(f.description)}"`,
        `"${sanitizeCSV(f.student_name)}"`,
        f.student_id,
        `"${sanitizeCSV(f.technician_name)}"`,
        f.created_at,
        f.updated_at
      ].join(','))
    ].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="fault_reports.csv"');
    res.send(csv);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// FIX: Unknown /api/* routes return JSON 404 instead of serving index.html
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: `API route not found: ${req.method} ${req.path}` });
});

// Catch-all for frontend routes (SPA) — only for non-API paths
app.get('*', (req, res, next) => {
  // If it's a real file (like reset-password.html), let Express serve it
  if (req.path.includes('.')) {
    return next();
  }

  // Otherwise send index.html
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
// ─── STARTUP ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
(async () => {
  try {
    // FIX: Release the test connection back to the pool after verifying connectivity
    const conn = await pool.getConnection();
    conn.release();
    console.log('✅ MySQL connected successfully');
    await seedUsers();
    await seedSolutions();
    app.listen(PORT, () => console.log(`🚀 Lab Fault System running on Port ${PORT}`));
  } catch (err) {
    console.error('❌ MySQL connection failed:', err.message);
    console.error('   Make sure XAMPP MySQL is running and the database "lab_fault_system" exists.');
    process.exit(1);
  }
})();