/**
 * Fix existing diary dates in Notion
 * Extract date from title and update Notion date field
 */

import 'dotenv/config';

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = "9362df01-b45f-4352-a1a4-2312ed213756";

if (!NOTION_API_KEY) {
  console.error('NOTION_API_KEY is not set');
  process.exit(1);
}

/**
 * Query all diary entries from Notion
 */
async function queryAllDiaries() {
  const url = `https://api.notion.com/v1/databases/${DATABASE_ID}/query`;
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      page_size: 100,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to query database: ${response.statusText}`);
  }

  const data = await response.json();
  return data.results;
}

/**
 * Extract date from title (e.g., "日記 2026/1/26" → "2026-01-26")
 */
function extractDateFromTitle(title) {
  const match = title.match(/日記\s*(\d{4})\/(\d{1,2})\/(\d{1,2})/);
  if (!match) {
    return null;
  }
  
  const year = match[1];
  const month = match[2].padStart(2, '0');
  const day = match[3].padStart(2, '0');
  
  return `${year}-${month}-${day}`;
}

/**
 * Update Notion page date field
 */
async function updatePageDate(pageId, newDate) {
  const url = `https://api.notion.com/v1/pages/${pageId}`;
  
  const response = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${NOTION_API_KEY}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      properties: {
        '日付': {
          date: {
            start: newDate,
            time_zone: null,
          },
        },
      },
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update page: ${response.statusText} - ${errorText}`);
  }

  return await response.json();
}

/**
 * Main function
 */
async function main() {
  console.log('Fetching all diary entries...');
  const pages = await queryAllDiaries();
  console.log(`Found ${pages.length} entries`);

  let updatedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const page of pages) {
    try {
      // Extract title
      const titleProperty = page.properties['タイトル'];
      if (!titleProperty || !titleProperty.title || titleProperty.title.length === 0) {
        console.log(`Skipping page ${page.id}: No title`);
        skippedCount++;
        continue;
      }
      
      const title = titleProperty.title[0].plain_text;
      
      // Extract current date
      const dateProperty = page.properties['日付'];
      const currentDate = dateProperty?.date?.start || null;
      
      // Extract date from title
      const extractedDate = extractDateFromTitle(title);
      
      if (!extractedDate) {
        console.log(`Skipping "${title}": Cannot extract date from title`);
        skippedCount++;
        continue;
      }
      
      // Check if update is needed
      if (currentDate === extractedDate) {
        console.log(`Skipping "${title}": Date already correct (${currentDate})`);
        skippedCount++;
        continue;
      }
      
      // Update date
      console.log(`Updating "${title}": ${currentDate} → ${extractedDate}`);
      await updatePageDate(page.id, extractedDate);
      updatedCount++;
      
      // Add delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 300));
      
    } catch (error) {
      console.error(`Error processing page ${page.id}:`, error.message);
      errorCount++;
    }
  }

  console.log('\n=== Summary ===');
  console.log(`Total entries: ${pages.length}`);
  console.log(`Updated: ${updatedCount}`);
  console.log(`Skipped: ${skippedCount}`);
  console.log(`Errors: ${errorCount}`);
}

main().catch(console.error);
