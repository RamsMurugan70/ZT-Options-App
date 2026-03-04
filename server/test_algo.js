const { exec } = require('child_process');
exec('python "d:/AI Projects/ZTA/ZT-Options-App/server/utils/nifty_algo_engine.py" live', (error, stdout, stderr) => {
    console.log('ERROR:', !!error);
    console.log('STDOUT:', stdout);
    console.log('STDERR:', stderr);
});
