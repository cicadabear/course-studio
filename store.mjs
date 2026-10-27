import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export const PROJECT = path.dirname(fileURLToPath(import.meta.url));
const configFile=path.join(PROJECT,'config.json');
if(!fs.existsSync(configFile))throw new Error('Missing config.json. Run npm run setup, then edit the configuration.');
export const config = JSON.parse(fs.readFileSync(configFile,'utf8'));
export const DATA = path.resolve(process.env.COURSE_DATA_DIR || path.join(PROJECT,'data'));
function assertDataOutsideMedia(filename){
  const target=path.resolve(filename);
  const roots=[config.mediaRoot,...(config.mediaRoots||[]),...(config.collections||[]).map(source=>source.root)].filter(Boolean);
  for(const root of roots){
    const relative=path.relative(path.resolve(root),target);
    if(relative===''||relative!=='..'&&!relative.startsWith('..'+path.sep)&&!path.isAbsolute(relative))throw new Error('Database and cache must be outside media directories.');
  }
}
assertDataOutsideMedia(DATA);
export function openStore(filename=path.join(DATA,'courses.sqlite')) {
  assertDataOutsideMedia(filename);
  fs.mkdirSync(path.dirname(filename),{recursive:true});
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS courses (id TEXT PRIMARY KEY,title TEXT NOT NULL,author TEXT NOT NULL,folder TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL,active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY,course_id TEXT NOT NULL REFERENCES courses(id),title TEXT NOT NULL,section TEXT NOT NULL,sort_order INTEGER NOT NULL,kind TEXT NOT NULL,primary_file TEXT,document_file TEXT,duration REAL DEFAULT 0,active INTEGER DEFAULT 1);
    CREATE INDEX IF NOT EXISTS lesson_course ON lessons(course_id,active,sort_order);
    CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY,lesson_id TEXT REFERENCES lessons(id),relative_path TEXT NOT NULL,ext TEXT NOT NULL,size INTEGER NOT NULL,active INTEGER DEFAULT 1);
    CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT,username TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS progress (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,lesson_id TEXT NOT NULL REFERENCES lessons(id),position REAL NOT NULL DEFAULT 0,duration REAL NOT NULL DEFAULT 0,completed INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL,PRIMARY KEY(user_id,lesson_id));
    CREATE TABLE IF NOT EXISTS course_state (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,course_id TEXT NOT NULL REFERENCES courses(id),last_lesson_id TEXT,queue_json TEXT,rate REAL DEFAULT 1,autonext INTEGER DEFAULT 1,updated_at INTEGER DEFAULT 0,PRIMARY KEY(user_id,course_id));
    CREATE TABLE IF NOT EXISTS course_favorites (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,course_id TEXT NOT NULL REFERENCES courses(id),created_at INTEGER NOT NULL,PRIMARY KEY(user_id,course_id));
    CREATE TABLE IF NOT EXISTS lesson_favorites (user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,lesson_id TEXT NOT NULL REFERENCES lessons(id),created_at INTEGER NOT NULL,PRIMARY KEY(user_id,lesson_id));
    CREATE INDEX IF NOT EXISTS lesson_favorites_recent ON lesson_favorites(user_id,created_at DESC,lesson_id);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY,value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS transcripts (lesson_id TEXT PRIMARY KEY REFERENCES lessons(id),lines TEXT NOT NULL,chars INTEGER NOT NULL DEFAULT 0,source TEXT,created_at INTEGER,paragraphs TEXT,timed TEXT,ads TEXT,updated_at INTEGER DEFAULT 0);
    CREATE TABLE IF NOT EXISTS auth_locks (ip TEXT PRIMARY KEY,failures INTEGER NOT NULL DEFAULT 0,locked_until INTEGER NOT NULL DEFAULT 0,updated_at INTEGER NOT NULL);
  `);
  const columns=new Set(db.prepare('PRAGMA table_info(courses)').all().map(c=>c.name));
  if(!columns.has('price_yuan'))db.exec('ALTER TABLE courses ADD COLUMN price_yuan REAL');
  if(!columns.has('source_root'))db.exec("ALTER TABLE courses ADD COLUMN source_root TEXT NOT NULL DEFAULT ''");
  const fileColumns=new Set(db.prepare('PRAGMA table_info(files)').all().map(c=>c.name));
  if(!fileColumns.has('source_root'))db.exec("ALTER TABLE files ADD COLUMN source_root TEXT NOT NULL DEFAULT ''");
  const progressColumns=new Set(db.prepare('PRAGMA table_info(progress)').all().map(c=>c.name));
  if(!progressColumns.has('observed_at'))db.exec('ALTER TABLE progress ADD COLUMN observed_at INTEGER DEFAULT 0');
  const transcriptColumns=new Set(db.prepare('PRAGMA table_info(transcripts)').all().map(c=>c.name));
  for(const [name,type] of [['paragraphs','TEXT'],['timed','TEXT'],['ads','TEXT'],['updated_at','INTEGER DEFAULT 0']])
    if(!transcriptColumns.has(name))db.exec('ALTER TABLE transcripts ADD COLUMN '+name+' '+type);
  return db;
}
export function transaction(db,fn) {
  db.exec('BEGIN IMMEDIATE');
  try { const value=fn(); db.exec('COMMIT'); return value; } catch(e) { db.exec('ROLLBACK'); throw e; }
}
