-- SPDX-License-Identifier: Apache-2.0
-- Licensed to the Ed-Fi Alliance under one or more agreements.
-- The Ed-Fi Alliance licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

-- CalendarEventDescriptors
insert into edfi.descriptor (namespace,                                               codevalue, shortdescription,                 description,                                                                                                                                                                               discriminator)
                values ('uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'TRUE',    'IS a school/instructional day',  'Used with DescriptorMappings; denotes Ed-Fi CalendarEventDescriptor values that constitute an instructional/school day (used to compute the start and end dates of a school year)',        'edfi.CalendarEventDescriptor'),
                       ('uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE',   'NOT a school/instructional day', 'Used with DescriptorMappings; denotes Ed-Fi CalendarEventDescriptor values that do not constitute an instructional/school day (used to compute the start and end dates of a school year)', 'edfi.CalendarEventDescriptor')
on conflict do nothing;

-- ClassroomPositionDescriptor
insert into edfi.descriptor (namespace,                                                   codevalue, shortdescription,                        description,                                                                                                                              discriminator)
                values ('uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'TRUE',    'IS the primary teacher for the class',  'Used with DescriptorMappings; denotes Ed-Fi ClassroomPositionDescriptor values that constitute the primary teacher for the class',        'edfi.ClassroomPositionDescriptor'),
                       ('uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'FALSE',   'NOT the primary teacher for the class', 'Used with DescriptorMappings; denotes Ed-Fi ClassroomPositionDescriptor values that do not constitute the primary teacher for the class', 'edfi.ClassroomPositionDescriptor')
on conflict do nothing;

-- RaceDescriptor
insert into edfi.descriptor (namespace,                                      codevalue,                              shortdescription,                                                                                        description,                                                                                                                 discriminator)
                values ('uri://1edtech.org/oneroster12/RaceDescriptor', 'americanIndianOrAlaskaNative',         'Ed-Fi RaceDescriptors for OR 1.2 americanIndianOrAlaskaNative',         'Used with DescriptorMappings to map Ed-Fi RaceDescriptor values to the OneRoster 1.2 americanIndianOrAlaskaNative',         'edfi.RaceDescriptor'),
                       ('uri://1edtech.org/oneroster12/RaceDescriptor', 'asian',                                'Ed-Fi RaceDescriptors for OR 1.2 asian',                                'Used with DescriptorMappings to map Ed-Fi RaceDescriptor values to the OneRoster 1.2 asian',                                'edfi.RaceDescriptor'),
                       ('uri://1edtech.org/oneroster12/RaceDescriptor', 'blackOrAfricanAmerican',               'Ed-Fi RaceDescriptors for OR 1.2 blackOrAfricanAmerican',               'Used with DescriptorMappings to map Ed-Fi RaceDescriptor values to the OneRoster 1.2 blackOrAfricanAmerican',               'edfi.RaceDescriptor'),
                       ('uri://1edtech.org/oneroster12/RaceDescriptor', 'nativeHawaiianOrOtherPacificIslander', 'Ed-Fi RaceDescriptors for OR 1.2 nativeHawaiianOrOtherPacificIslander', 'Used with DescriptorMappings to map Ed-Fi RaceDescriptor values to the OneRoster 1.2 nativeHawaiianOrOtherPacificIslander', 'edfi.RaceDescriptor'),
                       ('uri://1edtech.org/oneroster12/RaceDescriptor', 'white',                                'Ed-Fi RaceDescriptors for OR 1.2 white',                                'Used with DescriptorMappings to map Ed-Fi RaceDescriptor values to the OneRoster 1.2 white',                                'edfi.RaceDescriptor')
on conflict do nothing;

-- SexDescriptor
insert into edfi.descriptor (namespace,                                     codevalue,     shortdescription,                             description,                                                                                                         discriminator)
                values ('uri://1edtech.org/oneroster12/SexDescriptor', 'male',        'OneRoster 1.2 GenderEnum value male',        'Used with DescriptorMappings to map Ed-Fi SexDescriptor values to the OneRoster 1.2 GenderEnum value male',        'edfi.RaceDescriptor'),
                       ('uri://1edtech.org/oneroster12/SexDescriptor', 'female',      'OneRoster 1.2 GenderEnum value female',      'Used with DescriptorMappings to map Ed-Fi SexDescriptor values to the OneRoster 1.2 GenderEnum value female',      'edfi.RaceDescriptor'),
                       ('uri://1edtech.org/oneroster12/SexDescriptor', 'unspecified', 'OneRoster 1.2 GenderEnum value unspecified', 'Used with DescriptorMappings to map Ed-Fi SexDescriptor values to the OneRoster 1.2 GenderEnum value unspecified', 'edfi.RaceDescriptor'),
                       ('uri://1edtech.org/oneroster12/SexDescriptor', 'other',       'OneRoster 1.2 GenderEnum value other',       'Used with DescriptorMappings to map Ed-Fi SexDescriptor values to the OneRoster 1.2 GenderEnum value other',       'edfi.RaceDescriptor')
on conflict do nothing;

-- StaffClassificationDescriptor
insert into edfi.descriptor (namespace,                                                     codevalue,               shortdescription,                                     description,                                                                                                                 discriminator)
                values ('uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'aide',                  'OneRoster 1.2 RoleEnum value aide',                  'Used with DescriptorMappings to map Ed-Fi StaffClassificationDescriptor values to the OneRoster 1.2 aide',                  'edfi.StaffClassificationDescriptor'),
                       ('uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor',             'OneRoster 1.2 RoleEnum value counselor',             'Used with DescriptorMappings to map Ed-Fi StaffClassificationDescriptor values to the OneRoster 1.2 counselor',             'edfi.StaffClassificationDescriptor'),
                       ('uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'OneRoster 1.2 RoleEnum value districtAdministrator', 'Used with DescriptorMappings to map Ed-Fi StaffClassificationDescriptor values to the OneRoster 1.2 districtAdministrator', 'edfi.StaffClassificationDescriptor'),
                       ('uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'principal',             'OneRoster 1.2 RoleEnum value principal',             'Used with DescriptorMappings to map Ed-Fi StaffClassificationDescriptor values to the OneRoster 1.2 principal',             'edfi.StaffClassificationDescriptor'),
                       ('uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'proctor',               'OneRoster 1.2 RoleEnum value proctor',               'Used with DescriptorMappings to map Ed-Fi StaffClassificationDescriptor values to the OneRoster 1.2 proctor',               'edfi.StaffClassificationDescriptor'),
                       ('uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'siteAdministrator',     'OneRoster 1.2 RoleEnum value siteAdministrator',     'Used with DescriptorMappings to map Ed-Fi StaffClassificationDescriptor values to the OneRoster 1.2 siteAdministrator',     'edfi.StaffClassificationDescriptor'),
                       ('uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'systemAdministrator',   'OneRoster 1.2 RoleEnum value systemAdministrator',   'Used with DescriptorMappings to map Ed-Fi StaffClassificationDescriptor values to the OneRoster 1.2 systemAdministrator',   'edfi.StaffClassificationDescriptor'),
                       ('uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'OneRoster 1.2 RoleEnum value teacher',               'Used with DescriptorMappings to map Ed-Fi StaffClassificationDescriptor values to the OneRoster 1.2 teacher',               'edfi.StaffClassificationDescriptor')
on conflict do nothing;

-- SexDescriptor
insert into edfi.descriptor (namespace,                                      codevalue,       shortdescription,                                    description,                                                                                                                discriminator)
                values ('uri://1edtech.org/oneroster12/TermDescriptor', 'gradingPeriod', 'OneRoster 1.2 SessionTypeEnum value gradingPeriod', 'Used with DescriptorMappings to map Ed-Fi TermDescriptor values to the OneRoster 1.2 SessionTypeEnum value gradingPeriod', 'edfi.TermDescriptor'),
                       ('uri://1edtech.org/oneroster12/TermDescriptor', 'semester',      'OneRoster 1.2 SessionTypeEnum value semester',      'Used with DescriptorMappings to map Ed-Fi TermDescriptor values to the OneRoster 1.2 SessionTypeEnum value semester',      'edfi.TermDescriptor'),
                       ('uri://1edtech.org/oneroster12/TermDescriptor', 'schoolYear',    'OneRoster 1.2 SessionTypeEnum value schoolYear',    'Used with DescriptorMappings to map Ed-Fi TermDescriptor values to the OneRoster 1.2 SessionTypeEnum value schoolYear',    'edfi.TermDescriptor'),
                       ('uri://1edtech.org/oneroster12/TermDescriptor', 'term',          'OneRoster 1.2 SessionTypeEnum value term',          'Used with DescriptorMappings to map Ed-Fi TermDescriptor values to the OneRoster 1.2 SessionTypeEnum value term',          'edfi.TermDescriptor')
on conflict do nothing;
