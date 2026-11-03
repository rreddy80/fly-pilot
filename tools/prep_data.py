import sys, json, gzip, numpy as np, pandas as pd
D, OUT = sys.argv[1], sys.argv[2]
comp = pd.read_csv(f'{D}/Completeness_783.csv', index_col=0)
ids = comp.index.values
N = len(ids)
c = pd.read_parquet(f'{D}/Connectivity_783.parquet', columns=['Presynaptic_Index','Postsynaptic_Index','Excitatory x Connectivity'])
pre = c['Presynaptic_Index'].values.astype(np.int64); post = c['Postsynaptic_Index'].values.astype(np.int64)
w = c['Excitatory x Connectivity'].values.astype(np.int64)
o = np.lexsort((post, pre)); pre, post, w = pre[o], post[o], w[o]
counts = np.bincount(pre, minlength=N)
print('N', N, 'E', len(pre), 'max outdeg', counts.max(), 'max |w|', np.abs(w).max())

def varint(a):
    a = a.astype(np.uint64); out = []
    parts = []
    while True:
        b = (a & 0x7f).astype(np.uint8); a = a >> 7
        more = a > 0
        parts.append((b | (more.astype(np.uint8) << 7), more.copy()))
        if not more.any(): break
    # interleave per element
    nb = np.ones(len(parts[0][0]), np.int64)
    for _, m in parts[:-1]: nb += m  # count bytes
    buf = np.zeros(nb.sum(), np.uint8); start = np.concatenate([[0], np.cumsum(nb)[:-1]])
    alive = np.ones(len(nb), bool)
    for k, (b, m) in enumerate(parts):
        idx = start[alive] + k
        buf[idx] = b[alive]
        alive = alive & (nb > k + 1)
    return buf

# deltas of post within each pre row (first = absolute)
rowstart = np.concatenate([[0], np.cumsum(counts)[:-1]])
d = post.copy(); d[1:] = post[1:] - post[:-1]
first = np.zeros(len(pre), bool); first[rowstart[counts > 0]] = True
d[first] = post[first]
assert (d >= 0).all()
zz = (w << 1) ^ (w >> 63)
cnt_b = varint(counts); d_b = varint(d); w_b = varint(zz)
graph = b''.join([np.array([N, len(pre), len(cnt_b), len(d_b), len(w_b)], np.uint32).tobytes(), cnt_b.tobytes(), d_b.tobytes(), w_b.tobytes()])
gz = gzip.compress(graph, 9)
k = 3; L = -(-len(gz) // k)
for j in range(k): open(f'{OUT}/graph{j}.bin', 'wb').write(gz[j*L:(j+1)*L])
print('graph raw', len(graph)/1e6, 'gz', len(gz)/1e6)

a = pd.read_csv(f'{D}/Supplemental_file1_neuron_annotations.tsv', sep='\t', low_memory=False).set_index('root_id')
a = a.reindex(ids)
xyz = a[['pos_x','pos_y','pos_z']].values * np.array([4, 4, 40]) / 1000.0  # microns
ok = ~np.isnan(xyz).any(1)
ctr = np.nanmean(xyz, 0); xyz[~ok] = ctr
xyz = xyz - ctr
q = np.clip(np.round(xyz * 50), -32767, 32767).astype(np.int16)  # 0.02 um units
sc = a['super_class'].fillna('unknown')
sc_names = sorted(sc.unique()); sc_code = sc.map({s: i for i, s in enumerate(sc_names)}).values.astype(np.uint8)
ct = a['cell_type'].fillna(a['hemibrain_type']).fillna(a['cell_sub_class']).fillna(a['cell_class']).fillna('')
ct_names = [''] + sorted(set(ct) - {''}); ct_map = {s: i for i, s in enumerate(ct_names)}
ct_code = ct.map(ct_map).values.astype(np.uint16)
side = a['side'].fillna('').map({'left': 1, 'right': 2, 'center': 3}).fillna(0).values.astype(np.uint8)
nt = a['top_nt'].fillna('')
nt_names = sorted(nt.unique()); nt_code = nt.map({s: i for i, s in enumerate(nt_names)}).values.astype(np.uint8)
meta = b''.join([q.tobytes(), sc_code.tobytes(), side.tobytes(), nt_code.tobytes(), b'\0' * ((-3 * N) % 2), ct_code.tobytes()])
open(f'{OUT}/neurons.bin.gz', 'wb').write(gzip.compress(meta, 9))

def idx_where(mask): return np.where(mask)[0].tolist()
sub = a['cell_sub_class'].fillna(''); cls = a['cell_class'].fillna(''); typ = a['cell_type'].fillna('')
sugar_ids = [720575940624963786,720575940630233916,720575940637568838,720575940638202345,720575940617000768,720575940630797113,720575940632889389,720575940621754367,720575940621502051,720575940640649691,720575940639332736,720575940616885538,720575940639198653,720575940620900446,720575940617937543,720575940632425919,720575940633143833,720575940612670570,720575940628853239,720575940629176663,720575940611875570]
pos_of = {v: i for i, v in enumerate(ids)}
groups = {
  'sugar': [pos_of[i] for i in sugar_ids if i in pos_of],
  'bitter': idx_where((sub == 'bitter').values),
  'water': idx_where((sub == 'water').values),
  'groom': idx_where((sub == 'grooming').values),
  'looming': idx_where((typ == 'LPLC2').values),
  'heat': idx_where((sub == 'heating').values),
  'smell': idx_where(typ.str.startswith('ORN_DM1').values | typ.str.startswith('ORN_DM4').values),
  'wind': idx_where((sub == 'wind_gravity').values),
}
readouts = {
  'MN9': [pos_of[720575940660219265]],
  'GF': idx_where((typ == 'DNp01').values),
  'MDN': idx_where((typ == 'MDN').values),
  'aDN1': idx_where((typ == 'aDN1').values),
  'DNa02': idx_where((typ == 'DNa02').values),
}
for k, v in {**groups, **readouts}.items(): print(k, len(v))
json.dump({'N': N, 'superClasses': sc_names, 'neurotransmitters': nt_names, 'cellTypes': ct_names, 'groups': groups, 'readouts': readouts, 'ids_note': 'FlyWire v783 index order'}, open(f'{OUT}/meta.json', 'w'), separators=(',', ':'))
np.save(f'{OUT}/../build/ids.npy', ids)
