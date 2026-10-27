const port=Number(process.argv[2]);
if(!Number.isInteger(port)||port<1||port>65535)process.exit(1);
try{
  const response=await fetch('http://127.0.0.1:'+port+'/api/health',{signal:AbortSignal.timeout(1500)});
  const result=await response.json();
  process.exit(response.ok&&result.service==='course-studio'&&result.ok?0:1);
}catch{process.exit(1)}
