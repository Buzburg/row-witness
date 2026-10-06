import type { ColumnMapping, SourceInput } from './types';

export const demoBefore: SourceInput = {
  name: 'customers-monday.csv',
  delimiter: ',',
  text: `customer_id,company,plan,seats,owner,monthly_usd,last_seen
00101,Northstar Studio,Team,8,Alex Rivera,160.00,2026-09-28
00102,Juniper & Co.,Starter,3,Sam Chen,45.00,2026-09-28
00103,Harbor Design,Team,12,Alex Rivera,240.00,2026-09-27
00104,Paper Plane,Starter,2,Jo Ellis,30.00,2026-09-20
00105,Cedar Works,Team,6,Sam Chen,120.00,2026-09-28
00106,Field Notes,Team,10,Jo Ellis,200.00,2026-09-28
00107,Orbit Supply,Starter,4,Alex Rivera,60.00,2026-09-27
00108,Sunday Market,Team,15,Sam Chen,300.00,2026-09-28
00109,"Moss, Ink & Paper",Starter,2,Jo Ellis,30.00,2026-09-10
00110,Kinfolk Coffee,Team,7,Alex Rivera,140.00,2026-09-28
00111,Little Mountain,Starter,3,Sam Chen,45.00,2026-09-28
00112,Common Ground,Team,9,Jo Ellis,180.00,2026-09-28
00113,Westward Books,Starter,2,Alex Rivera,30.00,2026-09-28
00113,Westward Books,Team,5,Alex Rivera,100.00,2026-09-28
,Untitled account,Starter,1,Sam Chen,15.00,2026-09-28`,
};

export const demoAfter: SourceInput = {
  name: 'customers-friday.csv',
  delimiter: ',',
  text: `account_id,company,plan,seats,account_owner,monthly_usd,last_seen
00112,Common Ground,Team,9,Jo Ellis,180.00,2026-10-02
00101,Northstar Studio,Team,8,Alex Rivera,160.00,2026-10-02
00102,Juniper & Co.,Team,3,Sam Chen,60.00,2026-10-02
00103,Harbor Design,Team,18,Alex Rivera,240.00,2026-10-02
00105,Cedar Works,Team,6,Sam Chen,120.00,2026-10-02
00106,Field Notes,Team,10,Alex Rivera,200.00,2026-10-02
00107,Orbit Supply,Starter,4,Alex Rivera,60.00,2026-10-02
00108,Sunday Market,Team,15,Sam Chen,285.00,2026-10-02
00110,Kinfolk Coffee,Team,7,Alex Rivera,140.00,2026-10-02
00111,Little Mountain,Starter,3,Sam Chen,45.00,2026-10-02
00113,Westward Books,Team,5,Alex Rivera,100.00,2026-10-02
00114,Golden Hour,Starter,4,Jo Ellis,60.00,2026-10-02
00115,Good Measure,Team,6,Sam Chen,120.00,2026-10-02
,Untitled account,Starter,1,Sam Chen,15.00,2026-10-02`,
};

export const demoMappings: ColumnMapping[] = [
  { before: 'customer_id', after: 'account_id', role: 'key' },
  { before: 'company', after: 'company', role: 'compare' },
  { before: 'plan', after: 'plan', role: 'compare' },
  { before: 'seats', after: 'seats', role: 'compare' },
  { before: 'owner', after: 'account_owner', role: 'compare' },
  { before: 'monthly_usd', after: 'monthly_usd', role: 'compare' },
];
