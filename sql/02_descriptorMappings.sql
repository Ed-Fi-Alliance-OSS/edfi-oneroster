-- CalendarEventDescriptor mapping
insert into descriptormapping (namespace,                                 value,                                  mappednamespace,                                         mappedvalue, discriminator)
                       values ('uri://ed-fi.org/CalendarEventDescriptor', 'Emergency day',                        'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE',     'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Holiday',                              'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE',     'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Instructional day',                    'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'TRUE',      'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Make-up day',                          'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'TRUE',      'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Other',                                'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE',     'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Strike',                               'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE',     'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Student late arrival/early dismissal', 'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'TRUE',      'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Teacher only day',                     'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE',     'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Weather day',                          'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE',     'edfi.CalendarEventDescriptor'),
                              ('uri://ed-fi.org/CalendarEventDescriptor', 'Non-instructional day',                'uri://1edtech.org/oneroster12/CalendarEventDescriptor', 'FALSE',     'edfi.CalendarEventDescriptor')
on conflict do nothing;

-- ClassroomPositionDescriptor mapping
insert into descriptormapping (namespace,                                 value,                    mappednamespace,                                             mappedvalue, discriminator)
                       values ('uri://ed-fi.org/ClassroomPositionDescriptor', 'Assistant Teacher',  'uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'FALSE',     'edfi.ClassroomPositionDescriptor'),
                              ('uri://ed-fi.org/ClassroomPositionDescriptor', 'Substitute Teacher', 'uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'FALSE',     'edfi.ClassroomPositionDescriptor'),
                              ('uri://ed-fi.org/ClassroomPositionDescriptor', 'Support Teacher',    'uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'FALSE',     'edfi.ClassroomPositionDescriptor'),
                              ('uri://ed-fi.org/ClassroomPositionDescriptor', 'Teacher of Record',  'uri://1edtech.org/oneroster12/ClassroomPositionDescriptor', 'TRUE',      'edfi.ClassroomPositionDescriptor')
on conflict do nothing;

-- TermDescriptor mapping
insert into descriptormapping (namespace,                        value,                mappednamespace,                              mappedvalue,  discriminator)
                       values ('uri://ed-fi.org/TermDescriptor', 'Semester',         'uri://1edtech.org/oneroster12/TermDescriptor', 'semester',   'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Fall Semester',    'uri://1edtech.org/oneroster12/TermDescriptor', 'semester',   'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Spring Semester',  'uri://1edtech.org/oneroster12/TermDescriptor', 'semester',   'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Summer Semester',  'uri://1edtech.org/oneroster12/TermDescriptor', 'semester',   'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'First Quarter',    'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Second Quarter',   'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Third Quarter',    'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Fourth Quarter',   'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Trimester',        'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'First Trimester',  'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Second Trimester', 'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Third Trimester',  'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'MiniTerm',         'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Year Round',       'uri://1edtech.org/oneroster12/TermDescriptor', 'schoolYear', 'edfi.TermDescriptor'),
                              ('uri://ed-fi.org/TermDescriptor', 'Other',            'uri://1edtech.org/oneroster12/TermDescriptor', 'term',       'edfi.TermDescriptor')
on conflict do nothing;

-- RaceDescriptor mapping
insert into descriptormapping (namespace,                        value,                                 mappednamespace,                                mappedvalue,                            discriminator)
                       values ('uri://ed-fi.org/RaceDescriptor', 'American Indian or Alaska Native',    'uri://1edtech.org/oneroster12/RaceDescriptor', 'americanIndianOrAlaskaNative',         'edfi.RaceDescriptor'),
                              ('uri://ed-fi.org/RaceDescriptor', 'Asian',                               'uri://1edtech.org/oneroster12/RaceDescriptor', 'asian',                                'edfi.RaceDescriptor'),
                              ('uri://ed-fi.org/RaceDescriptor', 'Black or African American',           'uri://1edtech.org/oneroster12/RaceDescriptor', 'blackOrAfricanAmerican',               'edfi.RaceDescriptor'),
                              ('uri://ed-fi.org/RaceDescriptor', 'Native Hawaiian or Pacific Islander', 'uri://1edtech.org/oneroster12/RaceDescriptor', 'nativeHawaiianOrOtherPacificIslander', 'edfi.RaceDescriptor'),
                              ('uri://ed-fi.org/RaceDescriptor', 'White',                               'uri://1edtech.org/oneroster12/RaceDescriptor', 'white',                                'edfi.RaceDescriptor')
on conflict do nothing;

-- SexDescriptor mapping
insert into descriptormapping (namespace,                       value,          mappednamespace,                               mappedvalue,   discriminator)
                       values ('uri://ed-fi.org/SexDescriptor', 'Female',       'uri://1edtech.org/oneroster12/SexDescriptor', 'female',      'edfi.SexDescriptor'),
                              ('uri://ed-fi.org/SexDescriptor', 'Male',         'uri://1edtech.org/oneroster12/SexDescriptor', 'male',        'edfi.SexDescriptor'),
                              ('uri://ed-fi.org/SexDescriptor', 'Non-binary',   'uri://1edtech.org/oneroster12/SexDescriptor', 'other',       'edfi.SexDescriptor'),
                              ('uri://ed-fi.org/SexDescriptor', 'Not Selected', 'uri://1edtech.org/oneroster12/SexDescriptor', 'unspecified', 'edfi.SexDescriptor')
on conflict do nothing;

-- StaffClassificationDescriptor mapping
insert into descriptormapping (namespace,                                       value,                                 mappednamespace,                                              mappedvalue,              discriminator)
                       values ('uri://ed-fi.org/StaffClassificationDescriptor', 'Pre-Kindergarten Teacher',            'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Kindergarten Teacher',                'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Elementary Teacher',                  'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Secondary Teacher',                   'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Paraprofessional/Instructional Aide', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'aide',                  'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Ungraded Teacher',                    'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Elementary School Counselor',         'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor',             'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Secondary School Counselor',          'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor',             'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'School Counselor',                    'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor',             'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'LEA Administrator',                   'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'LEA Administrative Support Staff',    'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'School Administrator',                'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'siteAdministrator',     'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'School Administrative Support Staff', 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'siteAdministrator',     'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Assistant Principal',                 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'principal',             'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Assistant Superintendent',            'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Counselor',                           'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'counselor',             'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Instructional Aide',                  'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'aide',                  'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Instructional Coordinator',           'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'LEA System Administrator',            'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Principal',                           'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'principal',             'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'School Leader',                       'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'siteAdministrator',     'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'State Administrator',                 'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Substitute Teacher',                  'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Superintendent',                      'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'districtAdministrator', 'edfi.StaffClassificationDescriptor'),
                              ('uri://ed-fi.org/StaffClassificationDescriptor', 'Teacher',                             'uri://1edtech.org/oneroster12/StaffClassificationDescriptor', 'teacher',               'edfi.StaffClassificationDescriptor')
on conflict do nothing;

-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "Librarian/Media Specialist",                      "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "Library/Media Support Staff",                     "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "School Psychologist",                             "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "Student Support Services Staff (w/o Psychology)", "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "All Other Support Staff",                         "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "Instr Coordinator and Supervisor to the Staff",   "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "Missing",                                         "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "LEA Specialist",                                  "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "Operational Support",                             "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "Other",                                           "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "School Specialist",                               "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
-- { "namespace": "uri://ed-fi.org/StaffClassificationDescriptor", "value": "Support Services Staff",                          "mappedNamespace": "uri://1edtech.org/oneroster12/StaffClassificationDescriptor", "mappedValue": "?" }
