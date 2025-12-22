-- SPDX-License-Identifier: Apache-2.0
-- Licensed to EdTech Consortium, Inc. under one or more agreements.
-- EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

-- =============================================
-- MS SQL Server Descriptor Mappings for OneRoster 1.2
-- Maps Ed-Fi descriptors to OneRoster enums
-- =============================================

-- Set required options for Ed-Fi database operations
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO

-- CalendarEventDescriptor mapping
MERGE edfi.descriptormapping AS target
USING (VALUES
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Emergency day', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Holiday', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Instructional day', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'TRUE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Make-up day', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'TRUE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Other', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Strike', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Student late arrival/early dismissal', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'TRUE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Teacher only day', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Weather day', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE', 'edfi.CalendarEventDescriptor'),
    ('uri://ed-fi.org/CalendarEventDescriptor', 'Non-instructional day', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE', 'edfi.CalendarEventDescriptor')
) AS source ([namespace], value, mappednamespace, mappedvalue, discriminator)
ON target.[namespace] = source.[namespace] AND target.value = source.value
   AND target.mappednamespace = source.mappednamespace
WHEN NOT MATCHED THEN
    INSERT ([namespace], value, mappednamespace, mappedvalue, discriminator)
    VALUES (source.[namespace], source.value, source.mappednamespace, source.mappedvalue, source.discriminator);
GO

-- ClassroomPositionDescriptor mapping
MERGE edfi.descriptormapping AS target
USING (VALUES
    ('uri://ed-fi.org/ClassroomPositionDescriptor', 'Assistant Teacher', 'uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'FALSE', 'edfi.ClassroomPositionDescriptor'),
    ('uri://ed-fi.org/ClassroomPositionDescriptor', 'Substitute Teacher', 'uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'FALSE', 'edfi.ClassroomPositionDescriptor'),
    ('uri://ed-fi.org/ClassroomPositionDescriptor', 'Support Teacher', 'uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'FALSE', 'edfi.ClassroomPositionDescriptor'),
    ('uri://ed-fi.org/ClassroomPositionDescriptor', 'Teacher of Record', 'uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'TRUE', 'edfi.ClassroomPositionDescriptor')
) AS source ([namespace], value, mappednamespace, mappedvalue, discriminator)
ON target.[namespace] = source.[namespace] AND target.value = source.value
   AND target.mappednamespace = source.mappednamespace
WHEN NOT MATCHED THEN
    INSERT ([namespace], value, mappednamespace, mappedvalue, discriminator)
    VALUES (source.[namespace], source.value, source.mappednamespace, source.mappedvalue, source.discriminator);
GO

-- TermDescriptor mapping
MERGE edfi.descriptormapping AS target
USING (VALUES
    ('uri://ed-fi.org/TermDescriptor', 'Semester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'semester', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Fall Semester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'semester', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Spring Semester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'semester', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Summer Semester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'semester', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Quarter', 'uri://1edtech.org/oneroster12/TermDescriptor', 'term', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'First Quarter', 'uri://1edtech.org/oneroster12/TermDescriptor', 'term', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Second Quarter', 'uri://1edtech.org/oneroster12/TermDescriptor', 'term', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Third Quarter', 'uri://1edtech.org/oneroster12/TermDescriptor', 'term', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Fourth Quarter', 'uri://1edtech.org/oneroster12/TermDescriptor', 'term', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Trimester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'gradingPeriod', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'First Trimester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'gradingPeriod', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Second Trimester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'gradingPeriod', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Third Trimester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'gradingPeriod', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'MiniTerm', 'uri://1edtech.org/oneroster12/TermDescriptor', 'term', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Year Round', 'uri://1edtech.org/oneroster12/TermDescriptor', 'schoolYear', 'edfi.TermDescriptor'),
    ('uri://ed-fi.org/TermDescriptor', 'Other', 'uri://1edtech.org/oneroster12/TermDescriptor', 'term', 'edfi.TermDescriptor')
) AS source ([namespace], value, mappednamespace, mappedvalue, discriminator)
ON target.[namespace] = source.[namespace] AND target.value = source.value
   AND target.mappednamespace = source.mappednamespace
WHEN NOT MATCHED THEN
    INSERT ([namespace], value, mappednamespace, mappedvalue, discriminator)
    VALUES (source.[namespace], source.value, source.mappednamespace, source.mappedvalue, source.discriminator);
GO

-- RaceDescriptor mapping
MERGE edfi.descriptormapping AS target
USING (VALUES
    ('uri://ed-fi.org/RaceDescriptor', 'American Indian or Alaska Native', 'uri://1edtech.org/oneroster12/RaceDescriptor', 'americanIndianOrAlaskaNative', 'edfi.RaceDescriptor'),
    ('uri://ed-fi.org/RaceDescriptor', 'Asian', 'uri://1edtech.org/oneroster12/RaceDescriptor', 'asian', 'edfi.RaceDescriptor'),
    ('uri://ed-fi.org/RaceDescriptor', 'Black or African American', 'uri://1edtech.org/oneroster12/RaceDescriptor', 'blackOrAfricanAmerican', 'edfi.RaceDescriptor'),
    ('uri://ed-fi.org/RaceDescriptor', 'Native Hawaiian or Pacific Islander', 'uri://1edtech.org/oneroster12/RaceDescriptor', 'nativeHawaiianOrOtherPacificIslander', 'edfi.RaceDescriptor'),
    ('uri://ed-fi.org/RaceDescriptor', 'White', 'uri://1edtech.org/oneroster12/RaceDescriptor', 'white', 'edfi.RaceDescriptor')
) AS source ([namespace], value, mappednamespace, mappedvalue, discriminator)
ON target.[namespace] = source.[namespace] AND target.value = source.value
   AND target.mappednamespace = source.mappednamespace
WHEN NOT MATCHED THEN
    INSERT ([namespace], value, mappednamespace, mappedvalue, discriminator)
    VALUES (source.[namespace], source.value, source.mappednamespace, source.mappedvalue, source.discriminator);
GO

-- SexDescriptor mapping
MERGE edfi.descriptormapping AS target
USING (VALUES
    ('uri://ed-fi.org/SexDescriptor', 'Female', 'uri://1edtech.org/oneroster12/SexDescriptor', 'female', 'edfi.SexDescriptor'),
    ('uri://ed-fi.org/SexDescriptor', 'Male', 'uri://1edtech.org/oneroster12/SexDescriptor', 'male', 'edfi.SexDescriptor'),
    ('uri://ed-fi.org/SexDescriptor', 'Non-binary', 'uri://1edtech.org/oneroster12/SexDescriptor', 'other', 'edfi.SexDescriptor'),
    ('uri://ed-fi.org/SexDescriptor', 'Not Selected', 'uri://1edtech.org/oneroster12/SexDescriptor', 'unspecified', 'edfi.SexDescriptor')
) AS source ([namespace], value, mappednamespace, mappedvalue, discriminator)
ON target.[namespace] = source.[namespace] AND target.value = source.value
   AND target.mappednamespace = source.mappednamespace
WHEN NOT MATCHED THEN
    INSERT ([namespace], value, mappednamespace, mappedvalue, discriminator)
    VALUES (source.[namespace], source.value, source.mappednamespace, source.mappedvalue, source.discriminator);
GO

-- StaffClassificationDescriptor mapping
MERGE edfi.descriptormapping AS target
USING (VALUES
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Pre-Kindergarten Teacher', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Kindergarten Teacher', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Elementary Teacher', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Secondary Teacher', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Paraprofessional/Instructional Aide', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'aide', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Ungraded Teacher', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Elementary School Counselor', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Secondary School Counselor', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'School Counselor', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'LEA Administrator', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'LEA Administrative Support Staff', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'School Administrator', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'siteAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'School Administrative Support Staff', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'siteAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Assistant Principal', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'principal', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Assistant Superintendent', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Counselor', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Instructional Aide', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'aide', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Instructional Coordinator', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'LEA System Administrator', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Principal', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'principal', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'School Leader', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'siteAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'State Administrator', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Substitute Teacher', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Superintendent', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
    ('uri://ed-fi.org/StaffClassificationDescriptor', 'Teacher', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher', 'edfi.StaffClassificationDescriptor')
) AS source ([namespace], value, mappednamespace, mappedvalue, discriminator)
ON target.[namespace] = source.[namespace] AND target.value = source.value
   AND target.mappednamespace = source.mappednamespace
WHEN NOT MATCHED THEN
    INSERT ([namespace], value, mappednamespace, mappedvalue, discriminator)
    VALUES (source.[namespace], source.value, source.mappednamespace, source.mappedvalue, source.discriminator);
GO

PRINT 'OneRoster 1.2 descriptor mappings inserted successfully';
GO
