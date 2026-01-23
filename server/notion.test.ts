import { describe, it, expect } from 'vitest';
import { testNotionConnection, saveToNotion } from './notion';

describe('Notion REST API Integration', () => {
  it('should connect to Notion API successfully', async () => {
    const result = await testNotionConnection();
    expect(result).toBe(true);
  }, 10000); // 10 second timeout for API call

  it('should create a test page in Notion database', async () => {
    const testDate = new Date('2026-01-23T12:00:00+09:00');
    
    const result = await saveToNotion({
      title: 'テスト日記 2026/1/23',
      content: '• これはNotion REST API統合のテストです\n• MCP方式からREST API直接呼び出しに変更しました',
      tags: ['テスト'],
      date: testDate
    });
    
    expect(result.pageId).toBeTruthy();
    expect(result.pageUrl).toBeTruthy();
    expect(result.pageUrl).toContain('notion.so');
    
    console.log('Created test page:', result.pageUrl);
  }, 15000); // 15 second timeout for API call
});
