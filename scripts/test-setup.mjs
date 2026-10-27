import fs from 'node:fs';
import {fileURLToPath} from 'node:url';

fs.mkdirSync(fileURLToPath(new URL('../artifacts/',import.meta.url)),{recursive:true});
