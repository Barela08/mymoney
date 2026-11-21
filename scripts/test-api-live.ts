async function testApi() {
  try {
    const res = await fetch('http://localhost:5173/api/config/public');
    const data = await res.json();
    console.log('Public Config API response:', data);
  } catch (e) {
    console.error('Fetch error:', e);
  }
}

testApi();
