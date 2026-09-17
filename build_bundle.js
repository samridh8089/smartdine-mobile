const Metro = require('metro');
const path = require('path');
const fs = require('fs');

async function build() {
  console.log('Loading Metro config...');
  const config = await Metro.loadConfig({
    config: path.join(__dirname, 'metro.config.js')
  });

  const outDir = path.join(__dirname, 'dist-android');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  const outFile = path.join(outDir, 'index.android.bundle');

  console.log('Building Android JS bundle to:', outFile);
  await Metro.runBuild(config, {
    entry: path.join(__dirname, 'index.js'),
    platform: 'android',
    dev: false,
    minify: true,
    out: outFile,
    sourceMap: false
  });

  const stat = fs.statSync(outFile);
  console.log('Build complete! File size:', (stat.size / 1024 / 1024).toFixed(2), 'MB');
}

build().catch(err => {
  console.error('Build failed:', err);
  process.exit(1);
});
