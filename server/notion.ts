/**
 * Notion REST API integration
 * 
 * This module provides direct REST API access to Notion without MCP dependency.
 */

import { ENV } from './_core/env';

/**
 * Format Date object as JST date string (YYYY-MM-DD)
 * 
 * @param date - Date object to format
 * @returns Date string in YYYY-MM-DD format (JST)
 */
function formatDateAsJST(date: Date): string {
  // Use toLocaleString with 'sv-SE' locale to get YYYY-MM-DD HH:MM:SS format in JST
  const jstDateTimeStr = date.toLocaleString('sv-SE', { timeZone: 'Asia/Tokyo' });
  // Extract only the date part (YYYY-MM-DD)
  const jstDateStr = jstDateTimeStr.split(' ')[0];
  return jstDateStr;
}

export type SaveToNotionParams = {
  title: string;
  content: string;
  tags: string[];
  date: Date;
};

export type SaveToNotionResult = {
  pageId: string;
  pageUrl: string;
};

/**
 * Save diary entry to Notion database using REST API
 * 
 * @param params - Diary entry parameters
 * @returns Page ID and URL of the created Notion page
 * @throws Error if Notion API request fails
 */
export async function saveToNotion(params: SaveToNotionParams): Promise<SaveToNotionResult> {
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  const DATABASE_ID = "9362df01-b45f-4352-a1a4-2312ed213756";
  
  // Validate environment variables
  if (!NOTION_API_KEY) {
    throw new Error('NOTION_API_KEY environment variable is not set. Please configure it in the Management UI.');
  }
  
  // Validate date
  if (!params.date || isNaN(params.date.getTime())) {
    console.error("[saveToNotion] Invalid date provided, using current date");
    params.date = new Date();
  }
  
  console.log(`[saveToNotion] Saving with title: ${params.title}, date: ${params.date.toISOString()}`);
  
  try {
    // Prepare request body
    const requestBody = {
      parent: {
        type: "database_id",
        database_id: DATABASE_ID
      },
      properties: {
        // Title property (rich text)
        "タイトル": {
          title: [
            {
              type: "text",
              text: {
                content: params.title
              }
            }
          ]
        },
        // Content property (rich text)
        "本文": {
          rich_text: [
            {
              type: "text",
              text: {
                content: params.content
              }
            }
          ]
        },
        // Tags property (multi-select)
        "タグ": {
          multi_select: params.tags.map(tag => ({ name: tag }))
        },
        // Date property
        // Convert to JST date string (YYYY-MM-DD format)
        // toISOString() returns UTC, so we need to format as JST explicitly
        "日付": {
          date: {
            start: formatDateAsJST(params.date),
            time_zone: null // Don't specify timezone, let Notion use the date as-is
          }
        }
      }
    };
    
    console.log('[saveToNotion] Request body:', JSON.stringify(requestBody, null, 2));
    
    // Make API request
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    // Handle error responses
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[saveToNotion] Notion API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      
      // Provide user-friendly error messages
      if (response.status === 401) {
        throw new Error('Notion API authentication failed. Please check your NOTION_API_KEY.');
      } else if (response.status === 404) {
        throw new Error('Notion database not found. Please check the database ID and integration permissions.');
      } else if (response.status === 429) {
        throw new Error('Notion API rate limit exceeded. Please try again later.');
      } else if (response.status === 400) {
        const message = (errorData as any)?.message || 'Invalid request';
        throw new Error(`Notion API validation error: ${message}`);
      } else {
        const message = (errorData as any)?.message || response.statusText;
        throw new Error(`Notion API error (${response.status}): ${message}`);
      }
    }
    
    // Parse successful response
    const data = await response.json();
    
    console.log('[saveToNotion] Response data:', JSON.stringify(data, null, 2));
    
    // Extract page ID and URL
    const pageId = data.id;
    const pageUrl = data.url || `https://www.notion.so/${pageId.replace(/-/g, '')}`;
    
    console.log('[saveToNotion] Successfully created page:', pageId);
    console.log('[saveToNotion] Page URL:', pageUrl);
    
    return { pageId, pageUrl };
    
  } catch (error) {
    // Re-throw with context
    if (error instanceof Error) {
      console.error('[saveToNotion] Error:', error.message);
      throw error;
    } else {
      console.error('[saveToNotion] Unknown error:', error);
      throw new Error('Failed to save to Notion: Unknown error');
    }
  }
}

/**
 * Test Notion API connection
 * 
 * @returns True if connection is successful, false otherwise
 */
export async function testNotionConnection(): Promise<boolean> {
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  const DATABASE_ID = "9362df01-b45f-4352-a1a4-2312ed213756";
  
  if (!NOTION_API_KEY) {
    console.error('[testNotionConnection] NOTION_API_KEY is not set');
    return false;
  }
  
  try {
    // Retrieve database to test connection
    const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
      }
    });
    
    if (!response.ok) {
      console.error('[testNotionConnection] Failed:', response.status, response.statusText);
      return false;
    }
    
    console.log('[testNotionConnection] Connection successful');
    return true;
    
  } catch (error) {
    console.error('[testNotionConnection] Error:', error);
    return false;
  }
}
