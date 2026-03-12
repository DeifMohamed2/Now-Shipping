#!/bin/bash
# Create upload directories if they don't exist

echo "Creating upload directories..."

mkdir -p "public/uploads/tickets"
mkdir -p "public/uploads/profiles"
mkdir -p "public/uploads/shop"
mkdir -p "public/uploads/couriers"
mkdir -p "public/uploads/general"

echo "✅ Upload directories created successfully!"
echo ""
echo "Directory structure:"
echo "📁 public/uploads/"
echo "  ├── 📁 tickets/      (Ticket attachments)"
echo "  ├── 📁 profiles/     (User profile images)"
echo "  ├── 📁 shop/         (Product images)"
echo "  ├── 📁 couriers/     (Courier photos)"
echo "  └── 📁 general/      (Other files)"
echo ""
echo "Note: These directories are created with default permissions."
echo "If you have permission issues, run: chmod -R 755 public/uploads"
