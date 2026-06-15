-- WC2026 Full Group Stage Calendar
-- 72 fixtures with real kickoff times (UTC) and matchday-1 results
-- Generated 2026-06-15

CREATE TABLE IF NOT EXISTS wc_fixtures (
  id TEXT PRIMARY KEY,
  group_name TEXT NOT NULL,
  home_team_id TEXT NOT NULL,
  away_team_id TEXT NOT NULL,
  neutral_venue BOOLEAN NOT NULL DEFAULT TRUE,
  kickoff_utc TIMESTAMPTZ,
  venue TEXT,
  city TEXT,
  is_played BOOLEAN NOT NULL DEFAULT FALSE,
  home_goals INTEGER,
  away_goals INTEGER,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_wc_fixtures_updated_at ON wc_fixtures;
CREATE TRIGGER set_wc_fixtures_updated_at
  BEFORE UPDATE ON wc_fixtures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

ALTER TABLE wc_fixtures ENABLE ROW LEVEL SECURITY;
CREATE POLICY IF NOT EXISTS "Allow public read on wc_fixtures"
  ON wc_fixtures FOR SELECT USING (true);

-- ============================================================
-- INSERT all 72 group stage fixtures
-- ============================================================
INSERT INTO wc_fixtures (id, group_name, home_team_id, away_team_id, neutral_venue, kickoff_utc, venue, city, is_played, home_goals, away_goals) VALUES

-- GROUP A  (Mexico, South Africa, South Korea, Czechia)
('grp:A:mexico:south-africa','A','mexico','south-africa',true,'2026-06-11T19:00:00Z','Estadio Azteca','Ciudad de México',true,2,0),
('grp:A:south-korea:czechia','A','south-korea','czechia',true,'2026-06-12T02:00:00Z','Estadio Akron','Guadalajara',true,2,1),
('grp:A:south-africa:czechia','A','south-africa','czechia',true,'2026-06-18T16:00:00Z','Mercedes-Benz Stadium','Atlanta',false,null,null),
('grp:A:mexico:south-korea','A','mexico','south-korea',true,'2026-06-19T01:00:00Z','Estadio Akron','Zapopan',false,null,null),
('grp:A:mexico:czechia','A','mexico','czechia',true,'2026-06-25T01:00:00Z',null,null,false,null,null),
('grp:A:south-africa:south-korea','A','south-africa','south-korea',true,'2026-06-25T01:00:00Z',null,null,false,null,null),

-- GROUP B  (Canada, Bosnia-Herzegovina, Qatar, Switzerland)
('grp:B:canada:bosnia-and-herzegovina','B','canada','bosnia-and-herzegovina',true,'2026-06-12T19:00:00Z','BMO Field','Toronto',true,1,1),
('grp:B:qatar:switzerland','B','qatar','switzerland',true,'2026-06-13T19:00:00Z','Levi''s Stadium','Santa Clara',true,1,1),
('grp:B:bosnia-and-herzegovina:switzerland','B','bosnia-and-herzegovina','switzerland',true,'2026-06-18T19:00:00Z','SoFi Stadium','Inglewood',false,null,null),
('grp:B:canada:qatar','B','canada','qatar',true,'2026-06-18T22:00:00Z','BC Place','Vancouver',false,null,null),
('grp:B:canada:switzerland','B','canada','switzerland',true,'2026-06-24T19:00:00Z',null,null,false,null,null),
('grp:B:bosnia-and-herzegovina:qatar','B','bosnia-and-herzegovina','qatar',true,'2026-06-24T19:00:00Z',null,null,false,null,null),

-- GROUP C  (Brazil, Morocco, Haiti, Scotland)
('grp:C:brazil:morocco','C','brazil','morocco',true,'2026-06-13T22:00:00Z','MetLife Stadium','East Rutherford',true,1,1),
('grp:C:haiti:scotland','C','haiti','scotland',true,'2026-06-14T01:00:00Z','Gillette Stadium','Foxborough',true,0,1),
('grp:C:morocco:scotland','C','morocco','scotland',true,'2026-06-19T22:00:00Z','Gillette Stadium','Foxborough',false,null,null),
('grp:C:brazil:haiti','C','brazil','haiti',true,'2026-06-20T01:00:00Z','Lincoln Financial Field','Filadelfia',false,null,null),
('grp:C:brazil:scotland','C','brazil','scotland',true,'2026-06-24T22:00:00Z',null,null,false,null,null),
('grp:C:morocco:haiti','C','morocco','haiti',true,'2026-06-24T22:00:00Z',null,null,false,null,null),

-- GROUP D  (United States, Paraguay, Australia, Turkey)
('grp:D:united-states:paraguay','D','united-states','paraguay',true,'2026-06-13T01:00:00Z','SoFi Stadium','Inglewood',true,4,1),
('grp:D:australia:turkey','D','australia','turkey',true,'2026-06-14T04:00:00Z','BC Place','Vancouver',true,2,0),
('grp:D:united-states:australia','D','united-states','australia',true,'2026-06-19T19:00:00Z','Lumen Field','Seattle',false,null,null),
('grp:D:paraguay:turkey','D','paraguay','turkey',true,'2026-06-20T04:00:00Z','Levi''s Stadium','Santa Clara',false,null,null),
('grp:D:united-states:turkey','D','united-states','turkey',true,'2026-06-26T02:00:00Z',null,null,false,null,null),
('grp:D:paraguay:australia','D','paraguay','australia',true,'2026-06-26T02:00:00Z',null,null,false,null,null),

-- GROUP E  (Germany, Curacao, Ivory Coast, Ecuador)
('grp:E:germany:curacao','E','germany','curacao',true,'2026-06-14T17:00:00Z','NRG Stadium','Houston',true,7,1),
('grp:E:ivory-coast:ecuador','E','ivory-coast','ecuador',true,'2026-06-14T23:00:00Z','Lincoln Financial Field','Filadelfia',true,1,0),
('grp:E:germany:ivory-coast','E','germany','ivory-coast',true,'2026-06-20T20:00:00Z','BMO Field','Toronto',false,null,null),
('grp:E:curacao:ecuador','E','curacao','ecuador',true,'2026-06-21T00:00:00Z','Arrowhead Stadium','Kansas City',false,null,null),
('grp:E:germany:ecuador','E','germany','ecuador',true,'2026-06-25T20:00:00Z',null,null,false,null,null),
('grp:E:curacao:ivory-coast','E','curacao','ivory-coast',true,'2026-06-25T20:00:00Z',null,null,false,null,null),

-- GROUP F  (Netherlands, Japan, Sweden, Tunisia)
('grp:F:netherlands:japan','F','netherlands','japan',true,'2026-06-14T20:00:00Z','AT&T Stadium','Arlington',true,2,2),
('grp:F:sweden:tunisia','F','sweden','tunisia',true,'2026-06-15T02:00:00Z','Estadio BBVA','Monterrey',true,5,1),
('grp:F:netherlands:sweden','F','netherlands','sweden',true,'2026-06-20T17:00:00Z','NRG Stadium','Houston',false,null,null),
('grp:F:japan:tunisia','F','japan','tunisia',true,'2026-06-21T04:00:00Z','Estadio Akron','Guadalajara',false,null,null),
('grp:F:netherlands:tunisia','F','netherlands','tunisia',true,'2026-06-25T23:00:00Z','Arrowhead Stadium','Kansas City',false,null,null),
('grp:F:japan:sweden','F','japan','sweden',true,'2026-06-25T23:00:00Z','AT&T Stadium','Arlington',false,null,null),

-- GROUP G  (Belgium, Egypt, Iran, New Zealand)
('grp:G:belgium:egypt','G','belgium','egypt',true,'2026-06-15T19:00:00Z',null,null,false,null,null),
('grp:G:iran:new-zealand','G','iran','new-zealand',true,'2026-06-16T01:00:00Z',null,null,false,null,null),
('grp:G:belgium:iran','G','belgium','iran',true,'2026-06-21T19:00:00Z','SoFi Stadium','Inglewood',false,null,null),
('grp:G:egypt:new-zealand','G','egypt','new-zealand',true,'2026-06-22T01:00:00Z','BC Place','Vancouver',false,null,null),
('grp:G:egypt:iran','G','egypt','iran',true,'2026-06-27T03:00:00Z',null,null,false,null,null),
('grp:G:belgium:new-zealand','G','belgium','new-zealand',true,'2026-06-27T03:00:00Z',null,null,false,null,null),

-- GROUP H  (Spain, Cape Verde, Saudi Arabia, Uruguay)
('grp:H:spain:cape-verde','H','spain','cape-verde',true,'2026-06-15T16:00:00Z','Mercedes-Benz Stadium','Atlanta',false,null,null),
('grp:H:saudi-arabia:uruguay','H','saudi-arabia','uruguay',true,'2026-06-15T22:00:00Z','Hard Rock Stadium','Miami Gardens',false,null,null),
('grp:H:spain:saudi-arabia','H','spain','saudi-arabia',true,'2026-06-21T16:00:00Z','Mercedes-Benz Stadium','Atlanta',false,null,null),
('grp:H:cape-verde:uruguay','H','cape-verde','uruguay',true,'2026-06-21T22:00:00Z','Hard Rock Stadium','Miami Gardens',false,null,null),
('grp:H:spain:uruguay','H','spain','uruguay',true,'2026-06-27T00:00:00Z',null,null,false,null,null),
('grp:H:cape-verde:saudi-arabia','H','cape-verde','saudi-arabia',true,'2026-06-27T00:00:00Z',null,null,false,null,null),

-- GROUP I  (France, Senegal, Iraq, Norway)
('grp:I:france:senegal','I','france','senegal',true,'2026-06-16T19:00:00Z','MetLife Stadium','East Rutherford',false,null,null),
('grp:I:iraq:norway','I','iraq','norway',true,'2026-06-16T22:00:00Z',null,null,false,null,null),
('grp:I:france:iraq','I','france','iraq',true,'2026-06-22T21:00:00Z','Lincoln Financial Field','Filadelfia',false,null,null),
('grp:I:senegal:norway','I','senegal','norway',true,'2026-06-23T00:00:00Z','MetLife Stadium','East Rutherford',false,null,null),
('grp:I:france:norway','I','france','norway',true,'2026-06-26T19:00:00Z',null,null,false,null,null),
('grp:I:senegal:iraq','I','senegal','iraq',true,'2026-06-26T19:00:00Z',null,null,false,null,null),

-- GROUP J  (Argentina, Algeria, Austria, Jordan)
('grp:J:argentina:algeria','J','argentina','algeria',true,'2026-06-17T01:00:00Z','Arrowhead Stadium','Kansas City',false,null,null),
('grp:J:austria:jordan','J','austria','jordan',true,'2026-06-17T04:00:00Z',null,null,false,null,null),
('grp:J:argentina:austria','J','argentina','austria',true,'2026-06-22T17:00:00Z','AT&T Stadium','Arlington',false,null,null),
('grp:J:algeria:jordan','J','algeria','jordan',true,'2026-06-23T03:00:00Z','Levi''s Stadium','Santa Clara',false,null,null),
('grp:J:argentina:jordan','J','argentina','jordan',true,'2026-06-28T02:00:00Z','AT&T Stadium','Arlington',false,null,null),
('grp:J:algeria:austria','J','algeria','austria',true,'2026-06-28T02:00:00Z','Arrowhead Stadium','Kansas City',false,null,null),

-- GROUP K  (Portugal, Congo DR, Uzbekistan, Colombia)
('grp:K:portugal:congo-dr','K','portugal','congo-dr',true,'2026-06-17T17:00:00Z','NRG Stadium','Houston',false,null,null),
('grp:K:uzbekistan:colombia','K','uzbekistan','colombia',true,'2026-06-18T02:00:00Z',null,null,false,null,null),
('grp:K:portugal:uzbekistan','K','portugal','uzbekistan',true,'2026-06-23T17:00:00Z','NRG Stadium','Houston',false,null,null),
('grp:K:congo-dr:colombia','K','congo-dr','colombia',true,'2026-06-24T02:00:00Z','Estadio Akron','Zapopan',false,null,null),
('grp:K:portugal:colombia','K','portugal','colombia',true,'2026-06-27T23:30:00Z',null,null,false,null,null),
('grp:K:congo-dr:uzbekistan','K','congo-dr','uzbekistan',true,'2026-06-27T23:30:00Z',null,null,false,null,null),

-- GROUP L  (England, Croatia, Ghana, Panama)
('grp:L:england:croatia','L','england','croatia',true,'2026-06-17T20:00:00Z','AT&T Stadium','Arlington',false,null,null),
('grp:L:ghana:panama','L','ghana','panama',true,'2026-06-17T23:00:00Z',null,null,false,null,null),
('grp:L:england:ghana','L','england','ghana',true,'2026-06-23T20:00:00Z','Gillette Stadium','Foxborough',false,null,null),
('grp:L:croatia:panama','L','croatia','panama',true,'2026-06-23T23:00:00Z','BMO Field','Toronto',false,null,null),
('grp:L:england:panama','L','england','panama',true,'2026-06-27T21:00:00Z',null,null,false,null,null),
('grp:L:croatia:ghana','L','croatia','ghana',true,'2026-06-27T21:00:00Z',null,null,false,null,null)

ON CONFLICT (id) DO UPDATE SET
  kickoff_utc = EXCLUDED.kickoff_utc,
  venue = EXCLUDED.venue,
  city = EXCLUDED.city,
  is_played = EXCLUDED.is_played,
  home_goals = EXCLUDED.home_goals,
  away_goals = EXCLUDED.away_goals,
  updated_at = NOW();
