# Business API Postman Collection Setup Guide

## Overview
This repository contains a comprehensive Postman collection for the Business API of the Order Management System. The collection includes all endpoints for order management, pickup services, returns, transactions, and user profile management.

## Files Included
1. `Complete_Business_API_Collection.json` - The main Postman collection file
2. `Business_API_Documentation.md` - Comprehensive API documentation
3. `README_Postman_Setup.md` - This setup guide

## Prerequisites
- Postman application installed on your system
- Access to the Order Management System API
- Valid JWT authentication token

## Setup Instructions

### 1. Import the Collection
1. Open Postman
2. Click on "Import" button
3. Select "Upload Files"
4. Choose `Complete_Business_API_Collection.json`
5. Click "Import"

### 2. Configure Environment Variables
1. In Postman, click on the "Environments" tab
2. Create a new environment called "Business API"
3. Add the following variables:

| Variable | Initial Value | Current Value | Description |
|----------|---------------|---------------|-------------|
| `base_url` | `http://localhost:6098/api/v1/business` | `http://localhost:6098/api/v1/business` | Base URL for the API |
| `auth_token` | `your_jwt_token_here` | `your_jwt_token_here` | JWT authentication token |
| `order_id` | `507f1f77bcf86cd799439011` | `507f1f77bcf86cd799439011` | Sample order ID for testing |
| `pickup_number` | `789012` | `789012` | Sample pickup number for testing |

### 3. Set Up Authentication
1. Select the "Business API" environment
2. Update the `auth_token` variable with your actual JWT token
3. The collection is configured to use Bearer token authentication automatically

### 4. Test the API
1. Start with the "Get User Data" endpoint to verify authentication
2. Use the "Get Dashboard Data" endpoint to test basic functionality
3. Proceed with other endpoints as needed

## Collection Structure

The collection is organized into the following folders:

### 1. Authentication & User
- Get User Data
- Complete Account Setup
- Request Verification Email
- Edit Profile

### 2. Dashboard
- Get Dashboard Data

### 3. Orders
- Get Orders
- Submit Order
- Get Order Details
- Edit Order
- Cancel Order
- Delete Order
- Calculate Order Fees
- Print Order Policy

### 4. Return Orders
- Get Available Return Orders
- Get Return Orders
- Get Return Order Details
- Calculate Return Fees
- Mark Order as Returned

### 5. Pickups
- Get Pickups
- Create Pickup
- Get Pickup Details
- Get Picked Up Orders
- Rate Pickup
- Delete Pickup
- Calculate Pickup Fee

### 6. Waiting Actions
- Retry Tomorrow
- Retry Scheduled
- Return to Warehouse
- Cancel from Waiting

### 7. Transactions
- Get Transactions by Date

### 8. Cash Cycles
- Get Cash Cycle Data

### 9. Order Management
- Validate Original Order
- Recover Order Courier

## Authentication Flow

1. **Get JWT Token**: First, you need to authenticate and get a JWT token from the authentication endpoint (not included in this collection as it's typically handled by the auth service)

2. **Set Token**: Update the `auth_token` environment variable with your JWT token

3. **Use Token**: All endpoints in this collection will automatically use the Bearer token authentication

## Sample Data

The collection includes sample request bodies and responses for most endpoints. You can modify these as needed for your testing.

### Sample Order Creation
```json
{
  "fullName": "Ahmed Mohamed",
  "phoneNumber": "01234567890",
  "address": "123 Main Street, Nasr City",
  "government": "Cairo",
  "zone": "Zone A",
  "orderType": "Deliver",
  "productDescription": "Electronics - Smartphone",
  "numberOfItems": 1,
  "COD": true,
  "amountCOD": 2500,
  "previewPermission": true,
  "Notes": "Handle with care",
  "isExpressShipping": false
}
```

### Sample Pickup Creation
```json
{
  "numberOfOrders": 5,
  "pickupDate": "2024-02-15T10:00:00Z",
  "phoneNumber": "01234567890",
  "isFragileItems": true,
  "isLargeItems": false,
  "pickupNotes": "Handle with care - fragile items",
  "pickupLocation": "Main warehouse"
}
```

## Testing Workflow

### Basic Flow
1. **Authentication**: Get user data to verify authentication
2. **Dashboard**: Check dashboard data
3. **Orders**: Create, view, and manage orders
4. **Pickups**: Create and manage pickup requests
5. **Returns**: Handle return orders if needed

### Advanced Flow
1. **Complete Account Setup**: Set up business profile
2. **Create Orders**: Submit various types of orders
3. **Manage Pickups**: Schedule and track pickups
4. **Handle Returns**: Process return requests
5. **Monitor Transactions**: Track financial data

## Error Handling

The collection includes common error responses:
- 400: Bad Request
- 401: Unauthorized
- 403: Forbidden
- 404: Not Found
- 500: Internal Server Error

## Rate Limiting

Currently, there are no rate limits implemented, but it's recommended to implement reasonable limits in production.

## Troubleshooting

### Common Issues

1. **401 Unauthorized**
   - Check if the JWT token is valid
   - Ensure the token is properly set in the environment variable
   - Verify the token hasn't expired

2. **404 Not Found**
   - Check if the endpoint URL is correct
   - Verify the resource ID exists
   - Ensure you're using the correct base URL

3. **400 Bad Request**
   - Validate request body format
   - Check required fields are included
   - Verify data types and formats

4. **500 Internal Server Error**
   - Check server logs
   - Verify database connectivity
   - Contact development team

### Debug Tips

1. **Check Console**: Look at Postman console for detailed request/response information
2. **Validate JSON**: Ensure request bodies are valid JSON
3. **Test Authentication**: Start with simple endpoints like "Get User Data"
4. **Check Environment**: Verify environment variables are set correctly

## Support

For technical support or questions about the API:
1. Check the comprehensive documentation in `Business_API_Documentation.md`
2. Review the API endpoint responses for error details
3. Contact the development team with specific error messages and request details

## Updates

This collection will be updated as the API evolves. Please check for updates regularly and import new versions when available.

## Contributing

If you find issues or want to suggest improvements:
1. Document the issue with steps to reproduce
2. Include sample requests and responses
3. Suggest improvements with clear explanations
4. Contact the development team

---

**Note**: This collection is designed for testing and development purposes. Always use appropriate test data and avoid using production data unless absolutely necessary.


