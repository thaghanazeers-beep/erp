require('dotenv').config({ path: '../.env' });
const { Client } = require('@notionhq/client');

async function inspect() {
  const notionToken = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!notionToken || !databaseId) {
    console.error('Missing NOTION_TOKEN or NOTION_DATABASE_ID in backend/.env');
    return;
  }

  const notion = new Client({ auth: notionToken });

  try {
    console.log('Fetching database schema...');
    const db = await notion.databases.retrieve({ database_id: databaseId });
    
    console.log('\n--- Notion Database Properties ---');
    for (const [key, prop] of Object.entries(db.properties)) {
      console.log(`- ${key} (${prop.type})`);
    }

    console.log('\nFetching 1 sample task...');
    const response = await notion.databases.query({
      database_id: databaseId,
      page_size: 1,
    });

    if (response.results.length > 0) {
      console.log('\n--- Sample Task Data ---');
      console.log(JSON.stringify(response.results[0].properties, null, 2));
    } else {
      console.log('No tasks found in the database.');
    }
  } catch (error) {
    console.error('Error connecting to Notion:', error.message);
  }
}

inspect();
