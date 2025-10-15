# Gestionnaire de Paiements Immobiliers

## Overview

This is a French real estate payment management system built as a web application with Firebase authentication. The system allows users to manage members, track payments for real estate lots (villa, apartments, land), and view financial summaries. The application is designed for real estate agencies or property management companies operating in French-speaking regions, using FCFA currency.

## User Preferences

Preferred communication style: Simple, everyday language.

## System Architecture

### Frontend Architecture
- **Technology**: Vanilla JavaScript with HTML5 and CSS3
- **Architecture Pattern**: Single-page application (SPA) with tab-based navigation
- **State Management**: Class-based JavaScript (`PaymentManager`) with Firebase Realtime Database persistence
- **UI Framework**: Custom CSS with modern design system using CSS variables and responsive layouts
- **Design System**: Uses Inter font family with iOS-inspired design patterns and gradient backgrounds

### Backend & Hosting
- **Server**: Express.js serving static files on port 5000
- **Host**: 0.0.0.0 (required for Replit proxy compatibility)
- **Authentication**: Firebase Authentication with email/password
- **Database**: Firebase Realtime Database for multi-user data persistence

### Data Storage
- **Primary Storage**: Firebase Realtime Database with per-user data isolation
- **Data Structure**: JSON-based storage for three main entities: members, payment records, and lots
- **User Isolation**: Each user has their own data namespace: `users/{uid}/appData`
- **Real-time Sync**: Automatic synchronization across devices for the same user

### Application Structure
- **Main Controller**: `PaymentManager` class handles all application logic and state management
- **UI Management**: Tab-based interface with modal overlays for forms
- **Navigation**: Monthly navigation system for viewing payment history by time period

## Key Components

### Core Application Class
- **PaymentManager**: Main application controller that manages:
  - State initialization and persistence with localStorage
  - Event handling for all UI interactions
  - Data operations (CRUD for members, payments, and lots)
  - UI updates and statistics calculations
  - Monthly navigation and filtering

### Data Models
- **Members**: People participating in the payment system with selected lots and payment duration
- **Payments**: Transaction records with member associations, amounts, and dates
- **Lots**: Real estate properties available for purchase including:
  - Villas (e.g., "Villa Moderne A" - 25M FCFA)
  - Apartments (e.g., "Appartement Standing B" - 15M FCFA)
  - Land/Terrain (e.g., "Terrain Constructible C" - 8M FCFA)

### UI Components
- **Dashboard**: Overview with monthly summary and statistics in French
- **Header Statistics**: Real-time display of total members and monthly payments in FCFA
- **Monthly Navigation**: Previous/next month buttons for viewing historical data
- **Forms**: Modal-based forms for adding/editing members and recording payments

## Data Flow

1. **Initialization**: Application loads data from localStorage on startup
2. **Default Data**: If no lots exist, loads predefined real estate properties
3. **User Interactions**: All actions trigger PaymentManager methods
4. **State Updates**: Data modifications update both memory and localStorage
5. **UI Refresh**: Statistics and displays update automatically after data changes
6. **Monthly Filtering**: Data can be filtered by month/year for historical viewing

## External Dependencies

- **Firebase**: Authentication and Realtime Database (v9.22.0 Compat)
- **Express.js**: Web server for static file serving
- **Google Fonts**: Inter font family for typography
- **Chart.js**: Data visualization for statistics
- **jsPDF & html2canvas**: PDF export functionality
- **XLSX**: Excel export functionality

## Authentication Flow

1. **Login Page** (`login.html`): User authentication entry point
   - Email/password login
   - New user registration
   - Password reset functionality
   - Auto-redirect to index.html if already authenticated
   - Uses sessionStorage flag to prevent redirect loops

2. **Main App** (`index.html`): Protected application interface
   - Redirects to login.html if user not authenticated
   - Loads user-specific data from Firebase
   - Displays user profile and logout functionality

## Recent Changes (October 2025)

- **Fixed infinite redirect loop**: Added sessionStorage-based flag system to prevent login/index redirect loops
- **Fixed auto-logout bug**: Removed duplicate PaymentManager initialization that caused immediate disconnection
- **Fixed JavaScript errors**: Removed call to non-existent loadDefaultLots() method
- **Fixed race condition**: PaymentManager now uses fallback to firebase.auth().currentUser to avoid null user timing issues
- **Improved initialization**: Added DOM readiness check and single-instance guard for PaymentManager
- **Better redirects**: Using window.location.replace() to avoid stale history and redirect loops
- **Configured for Replit**: Server properly configured with 0.0.0.0 host on port 5000
- **Workflow Setup**: Added Server workflow running `node server.js`
- **Dependencies Installed**: Express and all Node.js packages properly installed

## Deployment Strategy

- **Development**: Express server on port 5000 (Replit environment)
- **Production**: Can be deployed to Replit Deployments or any Node.js hosting
- **Environment**: Node.js with Express serving static files
- **Database**: Firebase (already configured, no additional setup needed)

The application follows a secure multi-user architecture for managing real estate payments, with French localization and FCFA currency formatting throughout. The design emphasizes user experience with smooth transitions and an intuitive interface for property management professionals.