-- Synthetic, minimal pre-migration-8 schema for the login/Builder journeys.
-- This is not a production backup or a general-purpose application seed.
-- Startup applies the real account, Builder, slot and importer migrations (8+).
CREATE TABLE Migrations (
    Id INT NOT NULL PRIMARY KEY,
    Name VARCHAR(255) NOT NULL,
    RunOn DATE NOT NULL
) ENGINE=InnoDB;
INSERT INTO Migrations VALUES
    (1, 'Synthetic baseline', '2026-01-01'),
    (2, 'Synthetic baseline', '2026-01-01'),
    (3, 'Synthetic baseline', '2026-01-01'),
    (4, 'Synthetic baseline', '2026-01-01'),
    (5, 'Synthetic baseline', '2026-01-01'),
    (6, 'Synthetic baseline', '2026-01-01'),
    (7, 'Synthetic baseline', '2026-01-01');

CREATE TABLE Members (
    Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Username VARCHAR(60) NOT NULL UNIQUE,
    Password VARCHAR(255) NOT NULL,
    Banned TINYINT NOT NULL DEFAULT 0,
    LastLoginDate DATETIME NULL,
    LastLoginIP VARCHAR(40) NULL
) ENGINE=InnoDB;
CREATE TABLE AuthTokens (
    Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Selector CHAR(12) NOT NULL UNIQUE,
    HashedValidator CHAR(64) NOT NULL,
    MemberId INT NOT NULL,
    StayLoggedIn TINYINT NOT NULL,
    Expires DATETIME NOT NULL,
    FOREIGN KEY (MemberId) REFERENCES Members(Id)
) ENGINE=InnoDB;
CREATE TABLE MemberRoleMap (MemberId INT NOT NULL, RoleId INT NOT NULL) ENGINE=InnoDB;
CREATE TABLE NotificationSettings (
    Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, MemberId INT NOT NULL UNIQUE,
    ItemAdded TINYINT DEFAULT 0, ItemUpdated TINYINT DEFAULT 0,
    MobAdded TINYINT DEFAULT 0, MobUpdated TINYINT DEFAULT 0,
    QuestAdded TINYINT DEFAULT 0, QuestUpdated TINYINT DEFAULT 0,
    WikiPageAdded TINYINT DEFAULT 0, WikiPageUpdated TINYINT DEFAULT 0,
    ChangelogAdded TINYINT DEFAULT 0
) ENGINE=InnoDB;
CREATE TABLE Permissions (Id INT NOT NULL PRIMARY KEY, Name VARCHAR(60) NOT NULL) ENGINE=InnoDB;
CREATE TABLE RolePermissionMap (
    RoleId INT NOT NULL, PermissionId INT NOT NULL,
    `Create` TINYINT, `Read` TINYINT, `Update` TINYINT, `Delete` TINYINT
) ENGINE=InnoDB;
CREATE TABLE Notifications (
    Id INT NOT NULL PRIMARY KEY, MemberId INT NOT NULL,
    NotificationChangeId INT NOT NULL, `Read` TINYINT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE NotificationChanges (
    Id INT NOT NULL PRIMARY KEY, ActorId INT NOT NULL, ObjectId INT NOT NULL,
    ObjectType VARCHAR(60), ObjectPage VARCHAR(60), ObjectName VARCHAR(255),
    Verb VARCHAR(60), CreatedOn DATETIME NOT NULL
) ENGINE=InnoDB;
CREATE TABLE NotificationQueue (
    Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, ActorId INT, ObjectId INT,
    ObjectType VARCHAR(60), ObjectPage VARCHAR(60), ObjectName VARCHAR(255),
    Verb VARCHAR(60), CreatedOn DATETIME
) ENGINE=InnoDB;

CREATE TABLE Items (
    Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Name VARCHAR(255) NOT NULL,
    Slot INT NOT NULL,
    Strength INT DEFAULT 0,
    Mind INT DEFAULT 0,
    Dexterity INT DEFAULT 0,
    Constitution INT DEFAULT 0,
    Perception INT DEFAULT 0,
    Spirit INT DEFAULT 0,
    StrengthCap INT DEFAULT 0,
    MindCap INT DEFAULT 0,
    DexterityCap INT DEFAULT 0,
    ConstitutionCap INT DEFAULT 0,
    PerceptionCap INT DEFAULT 0,
    SpiritCap INT DEFAULT 0,
    Hit INT DEFAULT 0,
    Dam INT DEFAULT 0,
    Hp INT DEFAULT 0,
    Hpr INT DEFAULT 0,
    Ma INT DEFAULT 0,
    Mar INT DEFAULT 0,
    Mv INT DEFAULT 0,
    Mvr INT DEFAULT 0,
    Ac INT DEFAULT 0,
    Mitigation INT DEFAULT 0,
    Rent INT DEFAULT 0,
    Weight INT DEFAULT 0,
    UniqueWear TINYINT DEFAULT 0,
    IsLimited TINYINT DEFAULT 0,
    TwoHanded TINYINT DEFAULT 0,
    Holdable TINYINT DEFAULT 0,
    FauxObject TINYINT DEFAULT 0,
    IsLight TINYINT DEFAULT 0,
    AlignRestriction INT DEFAULT 0,
    WeaponStat INT DEFAULT 0,
    Casts TEXT NULL,
    Notes TEXT NULL,
    MobId INT DEFAULT 0,
    QuestId INT DEFAULT 0,
    NetStat DECIMAL(10, 2) DEFAULT 0,
    ModifiedByIP VARCHAR(40) NULL,
    Deleted TINYINT NOT NULL DEFAULT 0,
    ModifiedBy VARCHAR(60) NOT NULL DEFAULT 'Fixture',
    ModifiedOn DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE Items_AuditTrail LIKE Items;
ALTER TABLE Items_AuditTrail ADD COLUMN ItemId INT NOT NULL;

CREATE TABLE ItemStatCategories (
    Id INT NOT NULL PRIMARY KEY, Name VARCHAR(60) NOT NULL, SortNumber INT NOT NULL
) ENGINE=InnoDB;
CREATE TABLE ItemStatInfo (
    Id INT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    Display VARCHAR(60), Short VARCHAR(60), Var VARCHAR(60), Type VARCHAR(20),
    FilterString VARCHAR(60), DefaultValue VARCHAR(60), NetStat DECIMAL(10, 2),
    ShowColumnDefault TINYINT, Editable TINYINT, CategoryId INT, SortNumber INT
) ENGINE=InnoDB;
INSERT INTO ItemStatCategories VALUES (1, 'Basic', 1), (2, 'Attributes', 2), (6, 'Tank', 6);
INSERT INTO ItemStatInfo
    (Display, Short, Var, Type, FilterString, DefaultValue, NetStat, ShowColumnDefault, Editable, CategoryId, SortNumber)
VALUES
    ('Name', 'Name', 'name', 'string', '', '', 0, 1, 1, 1, 1),
    ('Strength', 'Str', 'strength', 'int', '> 0', '0', 1, 1, 1, 2, 2),
    ('Rent', 'Rent', 'rent', 'int', '> 0', '0', 0, 1, 1, 1, 3),
    ('Weight', 'Weight', 'weight', 'int', '> 0', '0', 0, 0, 1, 1, 4),
    ('Light', 'Light', 'isLight', 'bool', '= 1', 'false', 0, 0, 1, 1, 5),
    ('Faux Object', 'Faux', 'fauxObject', 'bool', '= 1', 'false', 0, 0, 1, 1, 6),
    ('Mitigation', 'Mit', 'mitigation', 'int', '> 0', '0', 2, 0, 1, 6, 700);
INSERT INTO Items (Id, Name, Slot, Strength, Rent, Weight, IsLight) VALUES
    (101, 'Test brass lantern', 0, 2, 100, 1, 1),
    (102, 'Test silver lantern', 0, 5, 200, 1, 1);
