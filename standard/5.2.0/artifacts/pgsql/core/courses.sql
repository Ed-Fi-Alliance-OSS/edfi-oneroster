-- SPDX-License-Identifier: Apache-2.0
-- Licensed to 1EdTech Consortium, Inc. under one or more agreements.
-- 1EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

drop index if exists oneroster12.courses_sourcedid;
drop materialized view if exists oneroster12.courses;
--
create materialized view if not exists oneroster12.courses as
with course as (
    select * from edfi.course
),
course_offerings as (
    -- one offering row per course (latest school year wins) so a course with
    -- offerings in multiple years still yields a single courses row.
    select coursecode, max(schoolyear) as schoolyear
    from edfi.courseoffering
    group by coursecode
)
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p8p2
select
    md5(concat(
                crs.educationOrganizationId::varchar,
                '-', crs.courseCode::varchar
            )) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi Courses
    'active' as "status",
    crs.lastmodifieddate as "dateLastModified",
    coursetitle as "title",
    CASE
        -- Only emit a schoolYear reference when the owner resolves to a School or an LEA:
        -- the academicsessions view only ever materializes schoolYear sessions per-LEA, so
        -- a course owned directly by a State Education Agency (or any other non-LEA org)
        -- has no matching academic session to reference.
        WHEN course_offerings.schoolyear IS NOT NULL
             AND (crs_school.localEducationAgencyId IS NOT NULL OR crs_lea.localEducationAgencyId IS NOT NULL) THEN
            json_build_object(
                'href', concat('/academicSessions/', md5(concat(COALESCE(crs_school.localEducationAgencyId, crs.educationOrganizationId)::varchar, '-', course_offerings.schoolyear::text))),
                'sourcedId', md5(concat(COALESCE(crs_school.localEducationAgencyId, crs.educationOrganizationId)::varchar, '-', course_offerings.schoolyear::text)),
                'type', 'academicSession'
            )
        ELSE NULL
    END AS "schoolYear",
    crs.coursecode  as "courseCode",
    null as "grades",
    null::varchar as "subjects",
    json_build_object(
        'href', concat('/orgs/', md5(crs.educationOrganizationId::text)),
        'sourcedId', md5(crs.educationOrganizationId::text),
        'type', 'org'
    ) as "org",
    -- required to be SCED codes, not generally available
    null as "subjectCodes",
    json_build_object(
        'edfi', json_build_object(
            'resource', 'courses',
            'naturalKey', json_build_object(
                'educationOrganizationId', crs.educationOrganizationId,
                'courseCode', crs.coursecode
            )
        )
    ) AS metadata,
    crs.educationOrganizationId as "educationOrganizationId"
from course crs
    left join course_offerings
        on crs.coursecode = course_offerings.coursecode
    left join edfi.school crs_school
        on crs.educationOrganizationId = crs_school.schoolid
    left join edfi.localEducationAgency crs_lea
        on crs.educationOrganizationId = crs_lea.localEducationAgencyId;

-- Add an index so the materialized view can be refreshed _concurrently_:
create index if not exists courses_sourcedid ON oneroster12.courses ("sourcedId");

-- Authorization filters: org id lookups
create index if not exists courses_educationorganizationid on oneroster12.courses ("educationOrganizationId");
