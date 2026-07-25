import json, os, collections

sessions_dir = "sessions"
run_status_path = "run-status.json"

with open(run_status_path) as f:
    status = json.load(f)

sess_map = {}
for s in status:
    sf = s['session_file']
    sf = sf.replace('\\', '/').replace('\', '/')
    basename = os.path.basename(sf)
    sess_map[basename] = s

results = []
for fname in sorted(os.listdir(sessions_dir)):
    if not fname.endswith('.jsonl'):
        continue
    path = os.path.join(sessions_dir, fname)
    meta = sess_map.get(fname, {})
    
    events = []
    with open(path, 'r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except:
                    pass
    
    type_counts = collections.Counter(e.get('type') for e in events)
    tool_uses = [e for e in events if e.get('type') == 'tool_use']
    assistant_msgs = [e for e in events if e.get('type') == 'message' and e.get('message', {}).get('role') == 'assistant']
    usage_events = [e for e in events if e.get('type') == 'usage']
    
    tool_name_counter = collections.Counter()
    for e in tool_uses:
        tn = e.get('toolName') or e.get('tool_name') or ''
        tool_name_counter[tn] += 1
    
    results.append({
        'fname': fname,
        'name': meta.get('name', '?'),
        'method': meta.get('method', '?'),
        'scenario': meta.get('scenario', '?'),
        'rep': meta.get('repetition', '?'),
        'elapsed': meta.get('elapsed_wall_seconds', 0),
        'n_events': len(events),
        'type_counts': dict(type_counts),
        'n_tool_uses': len(tool_uses),
        'n_assistant_msgs': len(assistant_msgs),
        'n_usage': len(usage_events),
        'tool_names': dict(tool_name_counter),
        'usage_events': usage_events,
    })

for r in results:
    print("="*60)
    print(f"Session: {r['name']} ({r['method']}, rep={r['rep']})")
    print(f"  elapsed={r['elapsed']:.1f}s, n_events={r['n_events']}")
    print(f"  type_counts: {r['type_counts']}")
    print(f"  tool_uses={r['n_tool_uses']}, asst_msgs={r['n_assistant_msgs']}, usage_evts={r['n_usage']}")
    print(f"  tool_names: {r['tool_names']}")
    if r['usage_events']:
        u = r['usage_events'][0]
        print(f"  usage[0]: {u}")
    print()
