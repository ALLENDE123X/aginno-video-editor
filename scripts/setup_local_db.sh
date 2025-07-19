#!/bin/bash

# Aginno Video Editor - Local Database Setup Script
# This script installs PostgreSQL and sets up the local database with pgvector

set -e  # Exit on any error

echo "🚀 Setting up local PostgreSQL database for Aginno Video Editor..."

# Detect OS and install PostgreSQL
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS
    echo "📦 Detected macOS, using Homebrew..."
    
    if ! command -v brew &> /dev/null; then
        echo "❌ Homebrew not found. Please install Homebrew first:"
        echo "   /bin/bash -c \"\$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""
        exit 1
    fi
    
    if ! brew list postgresql@16 &> /dev/null; then
        echo "📦 Installing PostgreSQL 16..."
        brew install postgresql@16
    else
        echo "✅ PostgreSQL 16 already installed"
    fi
    
    echo "🔄 Starting PostgreSQL service..."
    brew services start postgresql@16
    
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux
    echo "📦 Detected Linux, using apt..."
    
    if ! command -v psql &> /dev/null; then
        echo "📦 Installing PostgreSQL..."
        sudo apt update
        sudo apt install -y postgresql postgresql-contrib
    else
        echo "✅ PostgreSQL already installed"
    fi
    
    echo "🔄 Starting PostgreSQL service..."
    sudo systemctl start postgresql
    sudo systemctl enable postgresql
    
else
    echo "❌ Unsupported OS: $OSTYPE"
    echo "Please install PostgreSQL manually and run the database setup commands"
    exit 1
fi

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 3

# Create database and user
echo "🗄️ Creating database and user..."

# Check if database already exists
if psql -lqt | cut -d \| -f 1 | grep -qw aginno_video_editor; then
    echo "✅ Database 'aginno_video_editor' already exists"
else
    echo "📝 Creating database 'aginno_video_editor'..."
    createdb aginno_video_editor
fi

# Check if user already exists
if psql -t -c "SELECT 1 FROM pg_roles WHERE rolname='aginno_user'" | grep -q 1; then
    echo "✅ User 'aginno_user' already exists"
else
    echo "👤 Creating user 'aginno_user'..."
    if [[ -n "$AGINNO_DB_PASSWORD" ]]; then
        createuser -P aginno_user --pwprompt <<< "$AGINNO_DB_PASSWORD"
    else
        echo "Please enter a password for the database user 'aginno_user':"
        createuser -P aginno_user
    fi
fi

# Grant privileges
echo "🔐 Granting privileges..."
psql -d aginno_video_editor -c "GRANT ALL PRIVILEGES ON DATABASE aginno_video_editor TO aginno_user;"
psql -d aginno_video_editor -c "GRANT ALL ON SCHEMA public TO aginno_user;"

# Install pgvector extension
echo "🔧 Installing pgvector extension..."
if [[ "$OSTYPE" == "darwin"* ]]; then
    # macOS - install via Homebrew
    if ! brew list pgvector &> /dev/null; then
        echo "📦 Installing pgvector..."
        brew install pgvector
    fi
elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
    # Linux - install via apt
    if ! dpkg -l | grep -q pgvector; then
        echo "📦 Installing pgvector..."
        sudo apt install -y postgresql-16-pgvector
    fi
fi

# Create the extension
psql -d aginno_video_editor -c "CREATE EXTENSION IF NOT EXISTS vector;"

echo ""
echo "✅ Database setup complete!"
echo ""
echo "📋 Next steps:"
echo "1. Add the following to your .env file:"
echo ""

# Generate DATABASE_URL
if [[ -n "$AGINNO_DB_PASSWORD" ]]; then
    echo "DATABASE_URL=postgresql://aginno_user:$AGINNO_DB_PASSWORD@localhost:5432/aginno_video_editor"
else
    echo "DATABASE_URL=postgresql://aginno_user:<your_password>@localhost:5432/aginno_video_editor"
fi

echo ""
echo "2. Run the bootstrap SQL:"
echo "   psql -d aginno_video_editor -U aginno_user -f db/bootstrap.sql"
echo ""
echo "3. Test the connection:"
echo "   npm run test:db"
echo "" 