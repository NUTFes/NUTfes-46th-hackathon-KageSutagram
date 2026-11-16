ALTER TABLE posts ADD COLUMN judge_token TEXT;
CREATE UNIQUE INDEX post_judge_token ON posts(judge_token);
CREATE INDEX posts_status_created ON posts(status, created_at);
CREATE INDEX posts_place ON posts(place_id,status,created_at);
CREATE INDEX hashtag_tag ON hashtags(tag);
CREATE TRIGGER post_insert AFTER INSERT ON posts BEGIN
 UPDATE judge_tokens SET used_at=NEW.created_at WHERE token=NEW.judge_token;
 INSERT INTO daily_usage(device_id,date,post_count) VALUES(NEW.device_id,date(NEW.created_at,'+9 hours'),1) ON CONFLICT(device_id,date) DO UPDATE SET post_count=post_count+1;
END;
CREATE TRIGGER heart_insert AFTER INSERT ON hearts BEGIN UPDATE posts SET heart_count=heart_count+1 WHERE id=NEW.post_id; END;
CREATE TRIGGER heart_delete AFTER DELETE ON hearts BEGIN UPDATE posts SET heart_count=MAX(0,heart_count-1) WHERE id=OLD.post_id; END;
CREATE TRIGGER reply_insert AFTER INSERT ON replies WHEN NEW.status='published' BEGIN UPDATE posts SET reply_count=reply_count+1 WHERE id=NEW.post_id; END;
CREATE TRIGGER reply_status AFTER UPDATE OF status ON replies BEGIN UPDATE posts SET reply_count=(SELECT count(*) FROM replies WHERE post_id=NEW.post_id AND status='published') WHERE id=NEW.post_id; END;
CREATE TRIGGER report_insert AFTER INSERT ON reports BEGIN
 UPDATE posts SET report_count=report_count+1,status=CASE WHEN report_count+1>=3 THEN 'held' ELSE status END WHERE NEW.target_type='post' AND id=NEW.target_id;
 UPDATE replies SET report_count=report_count+1,status=CASE WHEN report_count+1>=3 THEN 'held' ELSE status END WHERE NEW.target_type='reply' AND id=NEW.target_id;
END;
