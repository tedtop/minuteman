# Fuel Dispatch Monitor

A web application for monitoring fuel dispatch operations using the QT Technologies API.

## Quick Start

### Prerequisites
- Node.js (version 14 or higher)
- npm (comes with Node.js)
- QT Technologies account credentials

### Installation & Running

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   # Edit .env with your QT Technologies credentials
   ```

3. **Start the proxy server:**
   ```bash
   npm start
   ```

4. **Open the application:**
   - The server will start on http://localhost:3000
   - Open http://localhost:3000/fuel_dispatch_app.html in your browser
   - The application will automatically authenticate and load dispatch data

## Why the Proxy Server?

The QT Technologies API doesn't allow direct browser requests due to CORS (Cross-Origin Resource Sharing) restrictions. The proxy server:

- Runs locally on your machine
- Handles authentication with QT Technologies
- Forwards API requests and responses
- Bypasses browser security restrictions

## Features

- **Automatic Authentication**: Uses credentials from environment variables
- **Real-time Data**: Polls for new dispatch data every 30 seconds
- **Responsive Design**: Works on desktop and mobile devices
- **Live Status**: Shows connection status and last update time

## Troubleshooting

### "Connection Error: Unable to connect to proxy server"
- Make sure you ran `npm start` and the server is running
- Check that the server is running on http://localhost:3000
- Look for error messages in the terminal where you started the server

### "No dispatch data available"
- Check the browser console (F12) for error messages
- Verify the QT Technologies API is accessible
- Check the terminal running the proxy server for API response logs

### Server won't start
- Make sure Node.js is installed: `node --version`
- Install dependencies: `npm install`
- Check if port 3000 is already in use

## Development

The application consists of:
- `fuel_dispatch_app.html` - Main web application
- `proxy-server.js` - Local proxy server to handle CORS
- `package.json` - Node.js dependencies
- `dispatches_with_change.json` - Sample API response structure