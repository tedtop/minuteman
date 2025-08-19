# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a single-page HTML application called "Fuel Dispatch Monitor" that provides a web interface for monitoring fuel dispatch operations for aircraft. The application is designed to integrate with QT Technologies' aviation fuel dispatch API.

## Architecture

- **Single-file application**: The entire application is contained in `fuel_dispatch_app.html`
- **Frontend-only**: Pure HTML, CSS, and JavaScript with no build system or dependencies
- **API Integration**: Designed to connect to QT Technologies' fuel dispatch API endpoints
- **Authentication**: Uses username/password authentication with company location ID and user ID
- **Real-time monitoring**: Implements polling-based data refresh every 30 seconds

## Key Components

### Authentication System
- Located in the `authenticate()` function using environment variables
- Automatically authenticates on page load using credentials from .env file
- Attempts QT portal login first, falls back to direct API access if needed
- Uses session-based authentication with cookies

### Data Fetching
- Main data retrieval in `fetchDispatchData()` function (fuel_dispatch_app.html:397)
- Makes actual API calls to QT Technologies GetDispatchDetail endpoint
- Uses session-based authentication with CORS and credentials: 'include'

### UI Components
- Responsive dispatch cards showing flight information
- Real-time status indicators (connected/disconnected/connecting)
- Form-based authentication interface
- Grid layout for multiple dispatch entries

## Development Notes

### Running the Application
- Install Node.js dependencies: `npm install`
- Start the proxy server: `npm start`
- Open http://localhost:3000/fuel_dispatch_app.html in browser
- Application automatically authenticates and loads data
- Proxy server handles CORS restrictions and API authentication

### API Integration
- Uses local proxy server at http://localhost:3000 to bypass CORS
- Proxy forwards requests to https://go.qttechnologies.com
- Login endpoint: `/api/login` (proxied to QT portal)
- Dispatch endpoint: `/api/dispatch` (proxied to GetDispatchDetail)
- Real API response structure defined in `dispatches_with_change.json`

### Configuration
- Poll interval: 30 seconds (configurable via POLL_INTERVAL env var)
- Credentials loaded from environment variables (see .env.example)
- Company location ID and user ID loaded from .env file
- Authentication token storage in memory (not persistent)

### Key Functions
- `authenticate()`: Handles user authentication
- `fetchDispatchData()`: Retrieves dispatch information
- `displayDispatchData()`: Renders dispatch cards
- `startMonitoring()`/`stopMonitoring()`: Controls automatic data refresh

## Push Notifications
The app includes PWA push notification functionality that automatically sends notifications when dispatch changes occur. Uses Vercel Fluid Compute for persistent subscription storage across serverless function invocations.

### Current Implementation
- **Primary Detection**: Uses QT's `ChangeFlags` field increments to detect all dispatch changes
- **Notification Types**: Fuel requests, dispatch updates, new flights
- **Delivery**: Real-time push notifications via web-push with VAPID authentication

### Future Enhancements (TODO)
- **Granular Change Detection**: Implement specific detection for different change types:
  - Status changes (In Flight → Completed, etc.)
  - Gate changes
  - Time changes (departure/arrival updates)  
  - Aircraft type changes
- **Enhanced Notification Categories**: Create specific notification types for each change category
- **Change History**: Track and display what specifically changed in each dispatch update