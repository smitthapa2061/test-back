const express = require('express');
const router = express.Router();
const {
  createUser,
  loginUser,
  logoutUser,
  updateUser,
  deleteUser,
  getAllUsers,
  getCurrentUser
} = require('../controller/User.controller.js');

// Admin protected user creation
router.post('/register', createUser);
router.get("/me", getCurrentUser); // session check route
// Login & logout
router.post('/login', loginUser);
router.post('/logout', logoutUser);

// CRUD
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
router.get('/', getAllUsers);

module.exports = router;
