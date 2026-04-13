/**
 * Quick Socket.io Connection Test
 * Run this to verify socket connection works
 */

import { io } from 'socket.io-client';
import jwt from 'jsonwebtoken';

// Configuration
const API_URL = process.env.API_URL || 'http://localhost:3000';
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// Create a test token
const testUserId = '507f1f77bcf86cd799439011'; // Sample MongoDB ObjectId
const testToken = jwt.sign(
    { 
        userId: testUserId, 
        role: 'HOST',
        hostId: testUserId 
    },
    JWT_SECRET,
    { expiresIn: '1h' }
);

console.log('🧪 Socket Connection Test');
console.log('========================');
console.log('API URL:', API_URL);
console.log('Test User ID:', testUserId);
console.log('Token:', testToken.substring(0, 50) + '...');
console.log('');

// Connect to socket
const socket = io(API_URL, {
    auth: { token: testToken },
    transports: ['websocket', 'polling'],
});

socket.on('connect', () => {
    console.log('✅ Connected successfully!');
    console.log('Socket ID:', socket.id);
    console.log('');
    
    // Test listening for host status update
    socket.on('host:status:updated', (data) => {
        console.log('🔥 Received host:status:updated event:', data);
    });
    
    console.log('Listening for host:status:updated events...');
    console.log('Keep this running and trigger admin approval to test.');
    console.log('Press Ctrl+C to exit.');
});

socket.on('connect_error', (err) => {
    console.error('❌ Connection error:', err.message);
    process.exit(1);
});

socket.on('disconnect', (reason) => {
    console.log('❌ Disconnected:', reason);
    if (reason === 'io server disconnect') {
        console.log('Server forcefully disconnected - check backend logs');
    }
    process.exit(1);
});

socket.on('error', (err) => {
    console.error('❌ Socket error:', err);
});

// Keep process alive
process.on('SIGINT', () => {
    console.log('\n\nDisconnecting...');
    socket.disconnect();
    process.exit(0);
});
