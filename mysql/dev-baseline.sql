USE `legendhub`;

-- Bridge the public 2020 development seed to the undocumented schema baseline
-- expected by the numbered migrations introduced in 2023.
ALTER TABLE Items
    ADD COLUMN StrengthCap INT(11) DEFAULT NULL AFTER Ac,
    ADD COLUMN MindCap INT(11) DEFAULT NULL AFTER StrengthCap,
    ADD COLUMN DexterityCap INT(11) DEFAULT NULL AFTER MindCap,
    ADD COLUMN ConstitutionCap INT(11) DEFAULT NULL AFTER DexterityCap,
    ADD COLUMN PerceptionCap INT(11) DEFAULT NULL AFTER ConstitutionCap,
    ADD COLUMN SpiritCap INT(11) DEFAULT NULL AFTER PerceptionCap,
    ADD COLUMN Soulbound TINYINT(4) DEFAULT 0 AFTER IsHeroic;

ALTER TABLE Items_AuditTrail
    ADD COLUMN StrengthCap INT(11) DEFAULT NULL AFTER Ac,
    ADD COLUMN MindCap INT(11) DEFAULT NULL AFTER StrengthCap,
    ADD COLUMN DexterityCap INT(11) DEFAULT NULL AFTER MindCap,
    ADD COLUMN ConstitutionCap INT(11) DEFAULT NULL AFTER DexterityCap,
    ADD COLUMN PerceptionCap INT(11) DEFAULT NULL AFTER ConstitutionCap,
    ADD COLUMN SpiritCap INT(11) DEFAULT NULL AFTER PerceptionCap,
    ADD COLUMN Soulbound TINYINT(4) DEFAULT 0 AFTER IsHeroic;

UPDATE ItemStatInfo
SET SortNumber = SortNumber + 6
WHERE SortNumber >= 12;

INSERT INTO ItemStatInfo
    (Display, Short, Var, Type, FilterString, DefaultValue, NetStat,
     ShowColumnDefault, Editable, CategoryId, SortNumber)
VALUES
    ('Strength Cap', 'Str Cap', 'strengthCap', 'int', '> 0', '0', 0.00, 0, 1, 9, 12),
    ('Mind Cap', 'Min Cap', 'mindCap', 'int', '> 0', '0', 0.00, 0, 1, 9, 13),
    ('Dexterity Cap', 'Dex Cap', 'dexterityCap', 'int', '> 0', '0', 0.00, 0, 1, 9, 14),
    ('Constitution Cap', 'Con Cap', 'constitutionCap', 'int', '> 0', '0', 0.00, 0, 1, 9, 15),
    ('Perception Cap', 'Per Cap', 'perceptionCap', 'int', '> 0', '0', 0.00, 0, 1, 9, 16),
    ('Spirit Cap', 'Spi Cap', 'spiritCap', 'int', '> 0', '0', 0.00, 0, 1, 9, 17);

UPDATE ItemStatInfo
SET SortNumber = SortNumber + 1
WHERE SortNumber >= 48;

INSERT INTO ItemStatInfo
    (Display, Short, Var, Type, FilterString, DefaultValue, NetStat,
     ShowColumnDefault, Editable, CategoryId, SortNumber)
VALUES
    ('Soulbound', 'Soulbound', 'soulbound', 'bool', '= 1', 'false', 0.00, 0, 1, 1, 48);
