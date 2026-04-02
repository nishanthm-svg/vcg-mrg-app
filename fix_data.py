"""Fix unkey to be unique per member (use memberCode), and add mppCode to each member."""
import json, os, glob

data_dir = os.path.join(os.path.dirname(__file__), 'data')
files = glob.glob(os.path.join(data_dir, 'exec_*.json'))

for fpath in files:
    with open(fpath, encoding='utf-8') as f:
        data = json.load(f)

    changed = False
    for mpp in data.get('mpps', []):
        for member in mpp.get('members', []):
            # Use memberCode as unkey (it's the unique 16-digit member ID)
            correct_unkey = str(member['memberCode'])
            if member['unkey'] != correct_unkey:
                member['unkey'] = correct_unkey
                changed = True
            # Ensure mppCode is on member (for identification records)
            if 'mppCode' not in member:
                member['mppCode'] = mpp['mppCode']
                changed = True

    # Also fix members inside bmcus
    for bmcu in data.get('bmcus', []):
        for mpp in bmcu.get('mpps', []):
            for member in mpp.get('members', []):
                correct_unkey = str(member['memberCode'])
                if member['unkey'] != correct_unkey:
                    member['unkey'] = correct_unkey
                    changed = True

    if changed:
        with open(fpath, 'w', encoding='utf-8') as f:
            json.dump(data, f, ensure_ascii=False, separators=(',', ':'))
        print(f'Fixed: {os.path.basename(fpath)}')
    else:
        print(f'OK:    {os.path.basename(fpath)}')

print('Done.')
