drop index if exists oneroster12.courses_sourcedid;
drop materialized view if exists oneroster12.courses;
--
create materialized view if not exists oneroster12.courses as
with course as (
    select * from edfi.course
),
-- want courses defined by district, so grab this from offerings and reduce down
course_leas as (
    select distinct coursecode, schoolyear, s.localEducationAgencyid
    from edfi.courseoffering co 
        join edfi.school s
            on co.schoolid = s.schoolid
)
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p8p2
select 
    md5(concat(
                course_leas.localEducationAgencyId::varchar,
                '-', crs.courseCode::varchar
            )) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi Courses
    'active' as "status",
    crs.lastmodifieddate as "dateLastModified",
    coursetitle as "title", 
    json_build_object(
        'href', concat('/academicSessions/', md5(course_leas.schoolyear::text)),
        'sourcedId', md5(course_leas.schoolyear::text),
        'type', 'academicSession'
    ) as "schoolYear", 
    crs.coursecode  as "courseCode", 
    null as "grades",
    null::varchar as "subjects",
    json_build_object(
        'href', concat('/orgs/', md5(course_leas.localEducationAgencyId::text)),
        'sourcedId', md5(course_leas.localEducationAgencyId::text),
        'type', 'org'
    ) as "org",
    -- required to be SCED codes, not generally available
    null as "subjectCodes",
    json_build_object(
        'edfi', json_build_object(
            'resource', 'courses',
            'naturalKey', json_build_object(
                'localEducationAgencyId', course_leas.localEducationAgencyId,
                'courseCode', crs.coursecode
            )
        )
    ) AS metadata
from course crs
    join course_leas
        on crs.coursecode = course_leas.coursecode;

-- Add an index so the materialized view can be refreshed _concurrently_:
create index if not exists courses_sourcedid ON oneroster12.courses ("sourcedId");