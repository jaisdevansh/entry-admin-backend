export const authorize = (...roles) => {
    const rolesUpper = roles.map(r => r.toUpperCase());
    return (req, res, next) => {
        const userRole = req.user?.role?.toUpperCase();
        if (!userRole || !rolesUpper.includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: `User role '${req.user ? req.user.role : 'Guest'}' is not authorized to access this route`,
                data: {}
            });
        }
        next();
    };
};
