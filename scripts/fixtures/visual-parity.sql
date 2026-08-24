USE `legendhub`;

INSERT INTO Members (Id, Username, Password, Banned, ReCaptcha)
VALUES (900001, 'ParityEditor',
  '$2y$10$LgwWXz73HTNYbu9ONw/Kqe739jIzuV8XU4ef/Fc4mORGYLqWTBejK', 0, 0);
INSERT INTO MemberRoleMap (MemberId, RoleId) VALUES (900001, 2);
INSERT INTO NotificationSettings (Id, MemberId, ItemAdded, ItemUpdated,
  MobAdded, MobUpdated, QuestAdded, QuestUpdated, WikiPageAdded,
  WikiPageUpdated, ChangelogAdded)
VALUES (900001, 900001, 1, 1, 1, 1, 1, 1, 1, 1, 1);

INSERT INTO Items (Id, Name, Slot, Strength, Hit, Dam, Hp, Rent, Notes,
  ModifiedBy, ModifiedOn, AlignRestriction, IsLight, IsLimited)
VALUES (900001, 'Parity lantern', 0, 3, 2, 1, 10, 125,
  'First line\nSecond line', 'ParityEditor', '2026-01-02 03:04:05', 0, 1, 1);
INSERT INTO Mobs (Id, Name, Xp, AreaId, Gold, ModifiedOn, ModifiedBy, Notes, Aggro)
VALUES (900001, 'Parity sentry', 450, 1, 12, '2026-01-02 03:04:05',
  'ParityEditor', 'Mob notes\nSecond line', 0);
INSERT INTO Quests (Id, Title, AreaId, Content, ModifiedOn, ModifiedBy, Whoises, Stat)
VALUES (900001, 'Parity errand', 1, 'Quest line one\nQuest line two',
  '2026-01-02 03:04:05', 'ParityEditor', 'parity', 0);
INSERT INTO WikiPages (Id, Title, CategoryId, SubCategoryId, Tags, Content,
  ModifiedOn, ModifiedBy)
VALUES
  (900001, 'Parity wiki page', 1, 1, 'parity', 'Wiki line one\nWiki line two',
   '2026-01-02 03:04:05', 'ParityEditor'),
  (900002, 'Smithing 90+ parity', 1, 1, 'smithing parity',
   'You will use the following commands:\nrecipe smithing\nrecipe smithing [name]\nsmith [tool/component] [component]',
   '2026-01-02 03:04:05', 'ParityEditor');

INSERT INTO Items_AuditTrail
  (Id, ItemId, Name, Slot, Strength, Hit, Dam, Hp, Rent, Notes,
   ModifiedBy, ModifiedOn, AlignRestriction, IsLight, IsLimited)
VALUES
  (900001, 900001, 'Parity lantern', 0, 3, 2, 1, 10, 125,
   'Earlier item notes', 'ParityEditor', '2026-01-01 03:04:05', 0, 1, 1);
INSERT INTO Mobs_AuditTrail
  (Id, MobId, Name, Xp, AreaId, Gold, ModifiedOn, ModifiedBy, Notes, Aggro)
VALUES
  (900001, 900001, 'Parity sentry', 400, 1, 10,
   '2026-01-01 03:04:05', 'ParityEditor', 'Earlier mob notes', 0);
INSERT INTO Quests_AuditTrail
  (Id, QuestId, Title, AreaId, Content, ModifiedOn, ModifiedBy, Whoises, Stat)
VALUES
  (900001, 900001, 'Parity errand', 1, 'Earlier quest text',
   '2026-01-01 03:04:05', 'ParityEditor', 'parity', 0);
INSERT INTO WikiPages_AuditTrail
  (Id, WikiPageId, Title, CategoryId, SubCategoryId, Tags, Content,
   ModifiedOn, ModifiedBy)
VALUES
  (900001, 900001, 'Parity wiki page', 1, 1, 'parity',
   'Earlier wiki text', '2026-01-01 03:04:05', 'ParityEditor'),
  (900002, 900002, 'Smithing 90+ parity', 1, 1, 'smithing parity',
   'Earlier smithing text', '2026-01-01 03:04:05', 'ParityEditor');
INSERT INTO NotificationChanges
  (Id, ActorId, ObjectId, ObjectType, ObjectPage, ObjectName, Verb, CreatedOn)
VALUES
  (900001, 900001, 900001, 'item', 'items', 'Parity lantern', 'updated',
   '2026-01-02 03:04:05');
INSERT INTO Notifications (Id, NotificationChangeId, MemberId, `Read`)
VALUES (900001, 900001, 900001, 0);
