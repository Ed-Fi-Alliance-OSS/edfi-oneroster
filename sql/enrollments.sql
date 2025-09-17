drop index if exists oneroster12.enrollments_sourcedid;
drop materialized view if exists oneroster12.enrollments;
--
create materialized view oneroster12.enrollments as
with staff_section_associations as (
    select * from edfi.staffSectionAssociation
),
student_section_associations as (
    select * from edfi.studentSectionAssociation
),
sections as (
    select * from edfi.section
),
staff_enrollments_formatted as (
    select
        md5(concat(
            lower(staff.staffUniqueId)::varchar,
            '-', lower(sections.localcoursecode)::varchar,
            '-', sections.schoolid::varchar,
            '-', lower(sections.sectionidentifier)::varchar,
            '-', lower(sections.sessionname)::varchar,
            '-', beginDate::varchar
        )) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi StaffSectionAssociations
        'active' as "status",
        ssa.lastmodifieddate as "dateLastModified",
        json_build_object(
            'href', concat('/classes/', md5(concat(
                lower(sections.localcoursecode)::varchar,
                '-', sections.schoolid::varchar,
                '-', lower(sections.sectionidentifier)::varchar,
                '-', lower(sections.sessionname)::varchar
            ))),
            'sourcedId', md5(concat(
                lower(sections.localcoursecode)::varchar,
                '-', sections.schoolid::varchar,
                '-', lower(sections.sectionidentifier)::varchar,
                '-', lower(sections.sessionname)::varchar
            )),
            'type', 'class'
        ) as "class",
        json_build_object(
            'href', concat('/users/', md5(staff.staffuniqueid)),
            'sourcedId', md5(staff.staffuniqueid),
            'type', 'user'
        ) as "user",
        json_build_object(
            'href', concat('/orgs/', md5(sections.schoolid::varchar)),
            'sourcedId', md5(sections.schoolid::varchar),
            'type', 'org'
        ) as "school",
        'teacher' as "role",
        'false' as "primary", -- xwalk.is_primary::boolean as "primary",
        ssa.beginDate::text as "beginDate",
        ssa.endDate::text as "endDate",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'staffSectionAssociations',
                'naturalKey', json_build_object(
                    'staffUniqueId', staff.staffUniqueId,
                    'localCourseCode', sections.localcoursecode,
                    'schoolId', sections.schoolid,
                    'sectionIdentifier', sections.sectionidentifier,
                    'sessionName', sections.sessionname,
                    'beginDate', beginDate
                )
            )
        ) AS metadata,
        -- Add natural key fields for ordering
        1 as sort_role_priority,  -- teacher=1 sorts before student=2
        sections.schoolid as sort_school,
        sections.localcoursecode as sort_course,
        sections.sectionidentifier as sort_section,
        sections.sessionname as sort_session,
        staff.staffuniqueid as sort_person,
        ssa.beginDate as sort_begin
    from staff_section_associations ssa
        join edfi.staff on ssa.staffusi = staff.staffusi
        join sections
            on ssa.sectionIdentifier = sections.sectionIdentifier
                and ssa.localCourseCode = sections.localCourseCode
                and ssa.schoolId = sections.schoolId
                and ssa.schoolYear = sections.schoolYear
                and ssa.sessionName = sections.sessionName
),
student_enrollments_formatted as (
    select
        md5(concat(
            lower(student.studentUniqueId)::varchar,
            '-', lower(sections.localcoursecode)::varchar,
            '-', sections.schoolid::varchar,
            '-', lower(sections.sectionidentifier)::varchar,
            '-', lower(sections.sessionname)::varchar,
            '-', beginDate::varchar
        )) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi StudentSectionAssociations
        'active' as "status",
        ssa.lastmodifieddate as "dateLastModified",
        json_build_object(
            'href', concat('/classes/', md5(concat(
                lower(sections.localcoursecode)::varchar,
                '-', sections.schoolid::varchar,
                '-', lower(sections.sectionidentifier)::varchar,
                '-', lower(sections.sessionname)::varchar
            ))),
            'sourcedId', md5(concat(
                lower(sections.localcoursecode)::varchar,
                '-', sections.schoolid::varchar,
                '-', lower(sections.sectionidentifier)::varchar,
                '-', lower(sections.sessionname)::varchar
            )),
            'type', 'class'
        ) as "class",
        json_build_object(
            'href', concat('/users/', md5(student.studentuniqueid)),
            'sourcedId', md5(student.studentuniqueid),
            'type', 'user'
        ) as "user",
        json_build_object(
            'href', concat('/orgs/', md5(sections.schoolid::varchar)),
            'sourcedId', md5(sections.schoolid::varchar),
            'type', 'org'
        ) as "school",
        'student' as "role",
        'false' as "primary",
        ssa.beginDate::text as "beginDate",
        ssa.endDate::text as "endDate",
        json_build_object(
            'edfi', json_build_object(
                'resource', 'studentSectionAssociations',
                'naturalKey', json_build_object(
                    'studentUniqueId', student.studentUniqueId,
                    'localCourseCode', sections.localcoursecode,
                    'schoolId', sections.schoolid,
                    'sectionIdentifier', sections.sectionidentifier,
                    'sessionName', sections.sessionname,
                    'beginDate', beginDate
                )
            )
        ) AS metadata,
        -- Add natural key fields for ordering
        2 as sort_role_priority,  -- student=2 sorts after teacher=1
        sections.schoolid as sort_school,
        sections.localcoursecode as sort_course,
        sections.sectionidentifier as sort_section,
        sections.sessionname as sort_session,
        student.studentuniqueid as sort_person,
        ssa.beginDate as sort_begin
    from student_section_associations ssa
        join edfi.student on ssa.studentusi = student.studentusi
        join sections
            on ssa.sectionIdentifier = sections.sectionIdentifier
                and ssa.localCourseCode = sections.localCourseCode
                and ssa.schoolId = sections.schoolId
                and ssa.schoolYear = sections.schoolYear
                and ssa.sessionName = sections.sessionName
),
all_enrollments as (
    select * from staff_enrollments_formatted
    union all
    select * from student_enrollments_formatted
)
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p12p2
select 
    "sourcedId", "status", "dateLastModified", "class", "user", "school",
    "role", "primary", "beginDate", "endDate", metadata
from all_enrollments
ORDER BY 
    sort_role_priority,  -- First by role (teacher before student)
    sort_school,         -- Then by school
    sort_course,         -- Then by course
    sort_section,        -- Then by section
    sort_session,        -- Then by session
    sort_person,         -- Then by person (staff or student)
    sort_begin;          -- Finally by begin date

-- Add an index so the materialized view can be refreshed _concurrently_:
create index enrollments_sourcedid ON oneroster12.enrollments ("sourcedId");