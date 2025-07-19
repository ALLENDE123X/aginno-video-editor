#!/usr/bin/env node

/**
 * Aginno Video Editor - Database Connection Test (JavaScript version)
 * This script tests the connection to the local PostgreSQL database
 */

import pg from "pg";
const { Client } = pg;

async function testDatabaseConnection() {
    const client = new Client({
        connectionString: process.env.DATABASE_URL
    });

    try {
        console.log("🔌 Testing database connection...");
        
        await client.connect();
        console.log("✅ Connected to database successfully");
        
        // Test basic query
        const result = await client.query("SELECT 1 AS ok, version() as pg_version");
        console.log("✅ Basic query successful:", result.rows[0]);
        
        // Test pgvector extension
        const vectorResult = await client.query("SELECT * FROM pg_extension WHERE extname = 'vector'");
        if (vectorResult.rows.length > 0) {
            console.log("✅ pgvector extension is installed");
        } else {
            console.log("❌ pgvector extension not found");
        }
        
        // Test tables exist
        const tablesResult = await client.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('videos', 'frames', 'transcripts', 'jobs')
            ORDER BY table_name
        `);
        
        console.log("📋 Available tables:");
        tablesResult.rows.forEach(row => {
            console.log(`   - ${row.table_name}`);
        });
        
        // Test vector operations
        try {
            await client.query("SELECT '[1,2,3]'::vector");
            console.log("✅ Vector operations working");
        } catch (error) {
            console.log("❌ Vector operations failed:", error.message);
        }
        
        console.log("\n🎉 Database test completed successfully!");
        
    } catch (error) {
        console.error("❌ Database connection failed:", error.message);
        process.exit(1);
    } finally {
        await client.end();
    }
}

// Check if DATABASE_URL is set
if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL environment variable not set");
    console.log("Please set it in your .env file:");
    console.log("DATABASE_URL=postgresql://aginno_user:<password>@localhost:5432/aginno_video_editor");
    process.exit(1);
}

// Run the test
testDatabaseConnection().catch(error => {
    console.error("❌ Test failed:", error);
    process.exit(1);
}); 