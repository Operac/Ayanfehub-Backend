
const reproduce = async () => {
    try {
        const response = await fetch('http://localhost:5000/api/checkout/validate-prices', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                items: [
                    { id: 'invalid-id', quantity: 1 }
                ]
            })
        });

        if (response.ok) {
            const data = await response.json();
            console.log('Response:', data);
        } else {
            console.error('Request failed:', response.status, response.statusText);
            const text = await response.text();
            console.error('Body:', text);
        }
    } catch (error) {
        console.error('Error reproducing crash:', error);
    }
};

reproduce();
