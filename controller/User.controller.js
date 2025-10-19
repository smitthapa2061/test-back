const User = require('../models/User.model.js');

// Admin secret code for creating users
const ADMIN_CODE = "9804344434";

// --- CREATE USER (Admin protected, auto-login) ---
const createUser = async (req, res) => {
  try {
    const { username, email, password, adminAuth, isAdmin } = req.body;

    if (adminAuth !== ADMIN_CODE) {
      return res.status(403).json({ message: "Invalid admin authentication code" });
    }

    if (!isAdmin) {
      return res.status(403).json({ message: "Not authorized to create user" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) return res.status(400).json({ message: "User already exists" });

    const user = new User({ username, email, password, isAdmin: !!isAdmin });
    await user.save(); // hash password

    // store userId in session
   req.session.userId = user._id;
req.session.save(err => {
  if (err) return res.status(500).json({ message: err.message });
  res.status(200).json({
    user: {
      _id: user._id,
      username: user.username,
      email: user.email,
      isAdmin: user.isAdmin,
    },
  });
});
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};


// --- LOGIN USER ---
// --- LOGIN USER ---
const loginUser = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ message: "User not found" });

    const isMatch = await user.matchPassword(password);
    if (!isMatch) return res.status(400).json({ message: "Invalid password" });

  
 

    req.session.userId = user._id;
  req.session.save(err => {
    if (err) {
      console.error('❌ Session save error:', err);
      return res.status(500).json({ message: err.message });
    }
    console.log('✅ Login successful, session saved:', req.sessionID);
    console.log('✅ User ID in session:', req.session.userId);
    const setCookie = res.get('set-cookie');
    res.status(200).json({
      user: {
        _id: user._id,
        username: user.username,
        email: user.email,
        isAdmin: user.isAdmin,
      },
      sessionId: req.sessionID,
      sessionCookie: setCookie ? setCookie[0] : null,
    });
  });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};


// --- LOGOUT USER ---
const logoutUser = (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid"); // session cookie
    res.json({ message: "Logged out successfully" });
  });
};

// --- UPDATE USER ---
const updateUser = async (req, res) => {
  try {
    const user = await User.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json(user);
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// --- DELETE USER ---
const deleteUser = async (req, res) => {
  try {
    const user = await User.findByIdAndDelete(req.params.id);
    if (!user) return res.status(404).json({ message: "User not found" });
    res.json({ message: "User deleted successfully" });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// --- GET ALL USERS (admin-only later) ---
const getAllUsers = async (req, res) => {
  try {
    const users = await User.find();
    res.json(users);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

const getCurrentUser = async (req, res) => {
  console.log('🔍 getCurrentUser called');
  console.log('🔍 Session ID:', req.sessionID);
  console.log('🔍 Session userId:', req.session?.userId);
  console.log('🔍 Session data:', req.session);
  
  if (!req.session.userId) {
    console.log('❌ No userId in session - user not logged in');
    return res.status(401).json({ message: "Not logged in" });
  }

  const user = await User.findById(req.session.userId).select("-password");
  if (!user) {
    console.log('❌ User not found in database');
    return res.status(404).json({ message: "User not found" });
  }

  const setCookie = res.get('set-cookie');
  console.log('✅ User found:', user.email);
  res.json({ ...user.toObject(), sessionId: req.sessionID, sessionCookie: setCookie ? setCookie[0] : null });
};


module.exports = {
  createUser,
  loginUser,
  logoutUser,
  updateUser,
  deleteUser,
  getAllUsers,
  getCurrentUser
};
