import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const config=path.join(root,'config.json');
if(fs.existsSync(config))console.log('config.json already exists; left unchanged.');
else{
  fs.copyFileSync(path.join(root,'config.example.json'),config);
  for(const dir of ['media/courses','media/youth'])fs.mkdirSync(path.join(root,dir),{recursive:true});
  console.log('Created config.json and empty media folders. Edit config.json before use.');
}
