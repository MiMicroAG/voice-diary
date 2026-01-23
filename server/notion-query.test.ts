import { describe, it, expect } from 'vitest';
import { queryDiaryEntries, updatePage, deletePage } from './notion';

describe('Notion query and merge functions', () => {
  it('should query diary entries', async () => {
    const entries = await queryDiaryEntries();
    
    console.log(`Found ${entries.length} diary entries`);
    
    expect(Array.isArray(entries)).toBe(true);
    
    if (entries.length > 0) {
      const entry = entries[0];
      expect(entry).toHaveProperty('pageId');
      expect(entry).toHaveProperty('pageUrl');
      expect(entry).toHaveProperty('title');
      expect(entry).toHaveProperty('content');
      expect(entry).toHaveProperty('tags');
      expect(entry).toHaveProperty('date');
      
      console.log('Sample entry:', {
        title: entry.title,
        date: entry.date,
        tags: entry.tags,
        contentLength: entry.content.length
      });
    }
  });

  it('should query diary entries by date range', async () => {
    const startDate = new Date('2026-01-20T00:00:00+09:00');
    const endDate = new Date('2026-01-23T00:00:00+09:00');
    
    const entries = await queryDiaryEntries({
      startDate,
      endDate
    });
    
    console.log(`Found ${entries.length} entries between 2026-01-20 and 2026-01-23`);
    
    expect(Array.isArray(entries)).toBe(true);
    
    // Verify all entries are within the date range
    for (const entry of entries) {
      const entryDate = new Date(entry.date + 'T00:00:00+09:00');
      expect(entryDate >= startDate).toBe(true);
      expect(entryDate <= endDate).toBe(true);
    }
  });

  it('should query diary entries by title', async () => {
    const entries = await queryDiaryEntries({
      title: '日記'
    });
    
    console.log(`Found ${entries.length} entries with title containing '日記'`);
    
    expect(Array.isArray(entries)).toBe(true);
    
    // Verify all entries have '日記' in the title
    for (const entry of entries) {
      expect(entry.title).toContain('日記');
    }
  });
});

describe('Notion merge duplicates logic', () => {
  it('should identify duplicate titles', async () => {
    const allEntries = await queryDiaryEntries();
    
    // Group by title
    const groupedByTitle = new Map<string, typeof allEntries>();
    for (const entry of allEntries) {
      const existing = groupedByTitle.get(entry.title) || [];
      existing.push(entry);
      groupedByTitle.set(entry.title, existing);
    }
    
    // Find duplicates
    const duplicates: string[] = [];
    for (const [title, entries] of groupedByTitle.entries()) {
      if (entries.length > 1) {
        duplicates.push(title);
        console.log(`Found ${entries.length} entries with title: ${title}`);
        
        // Show details
        for (const entry of entries) {
          console.log(`  - Date: ${entry.date}, Content length: ${entry.content.length}, Tags: ${entry.tags.join(', ')}`);
        }
      }
    }
    
    console.log(`Total duplicate titles: ${duplicates.length}`);
    
    expect(Array.isArray(duplicates)).toBe(true);
  });
});
