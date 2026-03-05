const { NseIndia } = require('stock-nse-india');
const nseIndia = new NseIndia();
nseIndia.getIndexOptionChain('NIFTY').then(data => {
    const dates = data.records.expiryDates;
    console.log("Expiry dates from records.expiryDates:", dates.slice(0, 3));

    if (data.records.data && data.records.data.length > 0) {
        const firstRecord = data.records.data[0];
        console.log("Expiry date format inside a record:", firstRecord.expiryDate);
        console.log(JSON.stringify(firstRecord, null, 2));
    } else {
        console.log("No data records found.");
    }
}).catch(console.error);
