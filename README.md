# Order Company Project - Return Management System

This document outlines the implementation of the return management system for the Order Company Project.

## Overview

The return management system allows businesses to initiate returns for delivered orders, track the return process, and receive refunds when applicable. The system supports both business-initiated returns and automatic returns for failed delivery attempts.

## Features

### For Businesses:
- Create return requests for completed orders
- View and track return status
- Cancel return requests (if still in 'requested' status)
- Receive notifications about return status changes

### For Couriers:
- View assigned return pickups
- Update return status (pick up returns, deliver to warehouse)
- Track return progress

### For Admins:
- Approve or reject return requests
- Assign couriers to pick up returns
- Process returns in the warehouse
- Issue refunds when necessary
- View all returns in the system

## Return Process Flow

1. **Return Request**: Business creates a return request for a delivered order
2. **Admin Review**: Admin approves or rejects the return request
3. **Courier Assignment**: Admin assigns a courier to pick up the return
4. **Pickup**: Courier picks up the return from the business
5. **Warehouse Delivery**: Courier delivers the return to the warehouse
6. **Processing**: Admin processes the return and issues refund if applicable
7. **Completion**: Return is marked as completed

## Technical Implementation

### Models:
- `Return`: Stores return information, stages, and status
- `Order` (updated): Added support for return tracking and failed delivery attempts

### Controllers:
- `returnController.js`: Handles all return-related functionality
- `courierController.js` (updated): Added support for failed delivery attempts
- `businessController.js` (updated): Added support for return creation

### Views:
- Business return management views
- Admin return management views
- Courier return management views

### Routes:
- Business return routes
- Admin return routes
- Courier return routes

## Automatic Returns

The system automatically creates return requests when:
- Multiple delivery attempts fail
- Customer rejects the order multiple times

## Return Statuses

- `requested`: Initial state when business creates a return request
- `approved`: Admin has approved the return request
- `rejected`: Admin has rejected the return request
- `pickedUp`: Courier has picked up the return from the business
- `inReturnStock`: Return is in the warehouse
- `processing`: Return is being processed by the admin
- `completed`: Return process is complete
- `canceled`: Return request was canceled by the business

## Integration with Existing System

The return management system is fully integrated with the existing Order Company Project infrastructure, including:
- Notification system
- User authentication
- Order management
- Courier management
