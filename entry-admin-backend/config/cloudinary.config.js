import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
});

/**
 * Upload a base64 image to Cloudinary
 * @param {string} base64Image - base64 encoded image string (data:image/jpeg;base64,...)
 * @param {string} folder - folder name in Cloudinary
 * @returns {Promise<string>} - secure URL of the uploaded image
 */
export const uploadToCloudinary = async (base64Data, folder = 'entry-club') => {
    // Check if it's an image or another document type to decide transformations
    const isImage = base64Data.startsWith('data:image');
    
    const options = {
        folder,
        resource_type: 'auto',
    };

    if (isImage) {
        options.transformation = [
            { quality: 'auto:good' },
            { fetch_format: 'auto' }
        ];
    }

    const result = await cloudinary.uploader.upload(base64Data, options);
    return result.secure_url;
};

/**
 * Upload multiple base64 images to Cloudinary
 * @param {string[]} images - array of base64 images
 * @param {string} folder - folder name in Cloudinary
 * @returns {Promise<string[]>} - array of secure URLs
 */
export const uploadManyToCloudinary = async (images = [], folder = 'entry-club') => {
    if (!images || images.length === 0) return [];
    const uploads = images.map(img => uploadToCloudinary(img, folder));
    return Promise.all(uploads);
};

export default cloudinary;
