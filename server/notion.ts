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

/**
 * Query diary entries from Notion database
 * 
 * @param options - Query options (date range, title filter)
 * @returns Array of diary entries
 */
export async function queryDiaryEntries(options?: {
  startDate?: Date;
  endDate?: Date;
  title?: string;
}): Promise<Array<{
  pageId: string;
  pageUrl: string;
  title: string;
  content: string;
  tags: string[];
  date: string; // YYYY-MM-DD
}>> {
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  const DATABASE_ID = "9362df01-b45f-4352-a1a4-2312ed213756";
  
  if (!NOTION_API_KEY) {
    throw new Error('NOTION_API_KEY environment variable is not set');
  }
  
  try {
    // Build filter
    const filter: any = { and: [] };
    
    if (options?.startDate) {
      filter.and.push({
        property: "日付",
        date: {
          on_or_after: formatDateAsJST(options.startDate)
        }
      });
    }
    
    if (options?.endDate) {
      filter.and.push({
        property: "日付",
        date: {
          on_or_before: formatDateAsJST(options.endDate)
        }
      });
    }
    
    if (options?.title) {
      filter.and.push({
        property: "タイトル",
        title: {
          contains: options.title
        }
      });
    }
    
    // If no filters, remove the 'and' wrapper
    const requestBody: any = {
      sorts: [
        {
          property: "日付",
          direction: "descending"
        }
      ]
    };
    
    if (filter.and.length > 0) {
      requestBody.filter = filter;
    }
    
    console.log('[queryDiaryEntries] Request body:', JSON.stringify(requestBody, null, 2));
    
    // Make API request
    const response = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}/query`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody)
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[queryDiaryEntries] Notion API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      throw new Error(`Notion API error (${response.status}): ${response.statusText}`);
    }
    
    const data = await response.json();
    console.log('[queryDiaryEntries] Found', data.results.length, 'entries');
    
    // Parse results
    const entries = data.results.map((page: any) => {
      const properties = page.properties;
      
      // Extract title
      const titleProp = properties['タイトル'];
      const title = titleProp?.title?.[0]?.plain_text || '';
      
      // Extract content
      const contentProp = properties['本文'];
      const content = contentProp?.rich_text?.[0]?.plain_text || '';
      
      // Extract tags
      const tagsProp = properties['タグ'];
      const tags = tagsProp?.multi_select?.map((tag: any) => tag.name) || [];
      
      // Extract date and normalize to YYYY-MM-DD format
      const dateProp = properties['日付'];
      let date = dateProp?.date?.start || '';
      
      // Normalize date to YYYY-MM-DD format (remove time and timezone if present)
      if (date && date.includes('T')) {
        date = date.split('T')[0];
      }
      
      return {
        pageId: page.id,
        pageUrl: page.url || `https://www.notion.so/${page.id.replace(/-/g, '')}`,
        title,
        content,
        tags,
        date
      };
    });
    
    return entries;
    
  } catch (error) {
    if (error instanceof Error) {
      console.error('[queryDiaryEntries] Error:', error.message);
      throw error;
    } else {
      console.error('[queryDiaryEntries] Unknown error:', error);
      throw new Error('Failed to query diary entries: Unknown error');
    }
  }
}

/**
 * Delete a Notion page
 * 
 * @param pageId - ID of the page to delete
 */
export async function deletePage(pageId: string): Promise<void> {
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  
  if (!NOTION_API_KEY) {
    throw new Error('NOTION_API_KEY environment variable is not set');
  }
  
  try {
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        archived: true
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[deletePage] Notion API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      throw new Error(`Failed to delete page: ${response.statusText}`);
    }
    
    console.log('[deletePage] Successfully deleted page:', pageId);
    
  } catch (error) {
    if (error instanceof Error) {
      console.error('[deletePage] Error:', error.message);
      throw error;
    } else {
      console.error('[deletePage] Unknown error:', error);
      throw new Error('Failed to delete page: Unknown error');
    }
  }
}

/**
 * Update a Notion page
 * 
 * @param pageId - ID of the page to update
 * @param params - Update parameters
 */
export async function updatePage(pageId: string, params: {
  title?: string;
  content?: string;
  tags?: string[];
  date?: Date;
}): Promise<void> {
  const NOTION_API_KEY = process.env.NOTION_API_KEY;
  
  if (!NOTION_API_KEY) {
    throw new Error('NOTION_API_KEY environment variable is not set');
  }
  
  try {
    const properties: any = {};
    
    if (params.title !== undefined) {
      properties['タイトル'] = {
        title: [
          {
            type: "text",
            text: {
              content: params.title
            }
          }
        ]
      };
    }
    
    if (params.content !== undefined) {
      properties['本文'] = {
        rich_text: [
          {
            type: "text",
            text: {
              content: params.content
            }
          }
        ]
      };
    }
    
    if (params.tags !== undefined) {
      properties['タグ'] = {
        multi_select: params.tags.map(tag => ({ name: tag }))
      };
    }
    
    if (params.date !== undefined) {
      properties['日付'] = {
        date: {
          start: formatDateAsJST(params.date),
          time_zone: null
        }
      };
    }
    
    const response = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${NOTION_API_KEY}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ properties })
    });
    
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('[updatePage] Notion API error:', {
        status: response.status,
        statusText: response.statusText,
        error: errorData
      });
      throw new Error(`Failed to update page: ${response.statusText}`);
    }
    
    console.log('[updatePage] Successfully updated page:', pageId);
    
  } catch (error) {
    if (error instanceof Error) {
      console.error('[updatePage] Error:', error.message);
      throw error;
    } else {
      console.error('[updatePage] Unknown error:', error);
      throw new Error('Failed to update page: Unknown error');
    }
  }
}
