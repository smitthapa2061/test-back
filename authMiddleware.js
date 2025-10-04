function requireAuth(req, res, next) {
   
      if (!req.session || !req.session.userId) { // Be explicit about checking for session existence too
        console.log("401 Unauthorized - req.session or userId missing for URL:", req.originalUrl);
        return res.status(401).json({ message: "Not logged in" });
      }
      console.log("requireAuth passed for URL:", req.originalUrl);
      next();
    }

module.exports = requireAuth;
