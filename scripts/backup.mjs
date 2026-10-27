import fs from 'node:fs';
import path from 'node:path';
import {openStore,DATA} from '../store.mjs';
const backups=path.join(DATA,'backups');fs.mkdirSync(backups,{recursive:true});
const target=path.join(backups,'courses-'+new Date().toISOString().replace(/[:.]/g,'-')+'.sqlite');
const db=openStore();
try{db.exec("VACUUM INTO '"+target.replaceAll("'","''")+"'");console.log('Backup saved: '+target)}finally{db.close()}
