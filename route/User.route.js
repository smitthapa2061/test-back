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
const { cacheMiddleware } = require('../middleware/cache.js');

// Admin protected user creation
router.post('/register', createUser);
router.get("/me", cacheMiddleware(), getCurrentUser); // session check route
// Login & logout
router.post('/login', loginUser);
router.post('/logout', logoutUser);

// CRUD
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);
router.get('/', cacheMiddleware(), getAllUsers);

module.exports = router;
