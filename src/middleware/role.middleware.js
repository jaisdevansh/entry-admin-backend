export const authorize = (...roles) => {
    const rolesUpper = roles.map(r => r.toUpperCase());
    return (req, res, next) => {
        const userRole = req.user?.role?.toUpperCase();
        console.log('[Authorize] Checking role:', { userRole, allowedRoles: rolesUpper, userId: req.user?.id });
        if (!userRole || !rolesUpper.includes(userRole)) {
            return res.status(403).json({
                success: false,
                message: `User role '${req.user ? req.user.role : 'Guest'}' is not authorized to access this route. Required: ${rolesUpper.join(', ')}`,
                data: {}
            });
        }
        next();
    };
};
