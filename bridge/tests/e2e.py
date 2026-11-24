import os, subprocess, socket, time, base64, secrets, struct, signal, json, select
from pathlib import Path
bridge_dir = Path(__file__).resolve().parents[1]
base = bridge_dir.parent
env = os.environ.copy()
env['ORT_DYLIB_PATH'] = str(base / 'runtime/onnxruntime-osx-arm64/lib/libonnxruntime.dylib')
env['PYTHONHOME'] = str(base / 'runtime/python')
env.pop('PYTHONPATH', None)
binary = Path(env.get('MAJSOUL_BRIDGE_BINARY', base / 'bin/majsoul-bridge-server'))
proc=subprocess.Popen([str(binary),'--seat','0','--listen','127.0.0.1:0','--model',str(base / 'model/model.onnx')],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
def vint(n):
 out=bytearray()
 while n>127: out.append((n & 127)|128); n >>= 7
 out.append(n); return bytes(out)
def fld(n,v): return vint(n*8+2)+vint(len(v))+v
def num(n,v): return vint(n*8)+vint(v)
def wrap(step,name,data):
 key=[0x84,0x5e,0x4e,0x42,0x39,0xa2,0x1f,0x60,0x1c]; size=len(data)
 encrypted=bytes(x^(((23^size)+5*i+key[i%9])&255) for i,x in enumerate(data))
 return b'\x01'+fld(1,b'.lq.ActionPrototype')+fld(2,num(1,step)+fld(2,name.encode())+fld(3,encrypted))
def send(sock,data,opcode=2):
 mask=secrets.token_bytes(4); n=len(data)
 hdr=bytes([0x80|opcode,0x80|n]) if n<126 else bytes([0x80|opcode,0x80|126])+struct.pack('!H',n)
 sock.sendall(hdr+mask+bytes(b^mask[i%4] for i,b in enumerate(data)))
def receive(stream):
 hdr=stream.read(2); assert len(hdr)==2 and hdr[0]==0x81, hdr
 n=hdr[1]&127
 if n==126: n=struct.unpack('!H',stream.read(2))[0]
 elif n==127: n=struct.unpack('!Q',stream.read(8))[0]
 assert n<=16384,n
 data=stream.read(n); assert len(data)==n
 return json.loads(data)
def handshake(sock, port):
 key=base64.b64encode(secrets.token_bytes(16)).decode()
 sock.sendall(f'GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n'.encode())
 stream=sock.makefile('rb')
 status=stream.readline(); assert b'101 Switching Protocols' in status, status
 while (header := stream.readline()) != b'\r\n':
  assert header, 'incomplete handshake'
 return stream
try:
 ready, _, _ = select.select([proc.stderr], [], [], 20)
 if not ready: raise RuntimeError('test server did not start in time')
 line = proc.stderr.readline().decode(errors='replace').strip()
 marker = 'listening on ws://127.0.0.1:'
 if not line.startswith(marker): raise RuntimeError(f'test server failed: {line}')
 port = int(line[len(marker):])
 sock=socket.create_connection(('127.0.0.1',port),timeout=5)
 sock.settimeout(15)
 stream=handshake(sock, port)
 tiles=['1m','2m','3m','4m','5m','6m','7m','8m','9m','1p','2p','3p','1z','2z']
 round_data=b''.join(fld(4,x.encode()) for x in tiles)+b''.join(num(6,25000) for _ in range(4))+fld(14,b'7s')
 send(sock,wrap(0,'ActionNewRound',round_data))
 clear=receive(stream); suggestion=receive(stream)
 assert clear['status']=='clear' and suggestion['source']=='model', (clear,suggestion)
 print('Received real-model recommendation:',suggestion)
 # Open independent connections to exercise the real ONNX model with each
 # personality and verify that zero intensity preserves the default result.
 for style, intensity in [('CallManiac', 1), ('SuperTurtle', 1), ('CallManiac', 0)]:
  other=socket.create_connection(('127.0.0.1',port),timeout=5); other.settimeout(15)
  other_stream=handshake(other, port)
  send(other,json.dumps({'type':'policy','style':style,'intensity':intensity,'revision':1}).encode(),1)
  ack=receive(other_stream); assert ack['status']=='policy_updated' and ack['style']==style, ack
  send(other,wrap(0,'ActionNewRound',round_data))
  clear=receive(other_stream); result=receive(other_stream)
  assert clear['status']=='clear' and result['source']=='model', (clear,result)
  if intensity==0: assert result==suggestion, (suggestion,result)
  print(f'{style} intensity {intensity}:',result['type'],result.get('pai',''))
  other_stream.close()
  other.close()
 # Exercise the incoming riichi wire flag and both warning levels with ONNX.
 sequence = [
  ('ActionDiscardTile', fld(2,b'2z')+num(5,1)),
  ('ActionDealTile', num(1,1)),
  ('ActionDiscardTile', num(1,1)+fld(2,b'9s')+num(3,1)+num(5,1)),
  ('ActionDealTile', num(1,2)+fld(5,num(1,1))),
  ('ActionDiscardTile', num(1,2)+fld(2,b'9p')+num(5,1)),
  ('ActionDealTile', num(1,3)),
  ('ActionDiscardTile', num(1,3)+fld(2,b'8s')+num(5,1)),
  ('ActionDealTile', fld(2,b'5s')),
 ]
 for step, (name, payload) in enumerate(sequence, 1):
  send(sock,wrap(step,name,payload))
  clear = receive(stream)
  assert clear['status']=='clear', (step,clear)
 advice = receive(stream)
 assert advice['source']=='model' and advice['riichi_threats']==1, advice
 warnings = advice['danger_tiles']
 assert any(w['pai']=='1m' and w['level']=='medium' for w in warnings), warnings
 assert any(w['pai']=='5m' and w['level']=='high' for w in warnings), warnings
 print('Confirmed orange 1m and red 5m after opponent riichi')
 send(sock,wrap(0,'ActionNewRound',round_data))
 assert receive(stream)['status']=='clear'
 assert receive(stream)['riichi_threats']==0
 sequence = [
  ('ActionDiscardTile', fld(2,b'2z')+num(5,1)),
  ('ActionDealTile', num(1,1)),
  ('ActionDiscardTile', num(1,1)+fld(2,b'9s')+num(5,1)),
 ]
 for honor in [b'5z', b'6z', b'7z']:
  call = num(1,1)+num(2,1)+fld(3,honor)*3+num(4,1)+num(4,1)+num(4,3)
  sequence.extend([
   ('ActionDealTile', num(1,2)),
   ('ActionDiscardTile', num(1,2)+fld(2,b'9p')+num(5,1)),
   ('ActionDealTile', num(1,3)),
   ('ActionDiscardTile', num(1,3)+fld(2,honor)+num(5,1)),
   ('ActionChiPengGang', call),
   ('ActionDiscardTile', num(1,1)+fld(2,b'9s')),
  ])
 sequence.extend([
  ('ActionDealTile', num(1,2)),
  ('ActionDiscardTile', num(1,2)+fld(2,b'8p')+num(5,1)),
  ('ActionDealTile', num(1,3)),
  ('ActionDiscardTile', num(1,3)+fld(2,b'8s')+num(5,1)),
  ('ActionDealTile', fld(2,b'5s')),
 ])
 for step, (name, payload) in enumerate(sequence, 1):
  send(sock,wrap(step,name,payload))
  clear = receive(stream)
  assert clear['status']=='clear', (step,clear)
 advice = receive(stream)
 assert advice['source']=='model' and advice['riichi_threats']==0, advice
 assert any(w['pai']=='5m' and w['level']=='medium' and w['threat_type']=='open'
            for w in advice['danger_tiles']), advice
 print('Confirmed orange 5m against an undeclared opponent with three open melds')
 proc.send_signal(signal.SIGINT)
 code=proc.wait(timeout=15)
 stderr=proc.stderr.read().decode(errors='replace')
 assert code==0,(code,stderr)
 print('Clean shutdown with active WebSocket: exit',code)
finally:
 if proc.poll() is None: proc.kill(); proc.wait()
