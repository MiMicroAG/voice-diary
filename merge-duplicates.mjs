/**
 * Merge duplicate diary entries with the same title
 * 
 * This script calls the mergeDuplicates API endpoint to consolidate
 * multiple diary entries with the same title into a single entry.
 */

async function mergeDuplicates() {
  try {
    console.log('Starting merge duplicates process...');
    
    const response = await fetch('http://localhost:3000/api/trpc/notion.mergeDuplicates', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({})
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! status: ${response.status}, body: ${errorText}`);
    }
    
    const data = await response.json();
    console.log('Merge complete:', data);
    
    if (data.result && data.result.data) {
      const { mergedCount, deletedCount } = data.result.data;
      console.log(`\n✅ Success!`);
      console.log(`   - Merged ${mergedCount} titles`);
      console.log(`   - Deleted ${deletedCount} duplicate entries`);
    }
    
  } catch (error) {
    console.error('❌ Merge failed:', error);
    process.exit(1);
  }
}

mergeDuplicates();
