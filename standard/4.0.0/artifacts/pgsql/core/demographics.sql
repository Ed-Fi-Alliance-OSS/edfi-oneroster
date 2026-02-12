-- SPDX-License-Identifier: Apache-2.0
-- Licensed to EdTech Consortium, Inc. under one or more agreements.
-- EdTech Consortium, Inc. licenses this file to you under the Apache License, Version 2.0.
-- See the LICENSE and NOTICES files in the project root for more information.

drop index if exists oneroster12.demographics_sourcedid;
drop materialized view if exists oneroster12.demographics;
--
create materialized view if not exists oneroster12.demographics as
with student as (
    select * from edfi.student
),
student_edorg as (
    select
        se.studentusi,
        se.educationorganizationid,
        bool_or(se.hispaniclatinoethnicity) as hispaniclatinoethnicity,
        max(se.lastmodifieddate) as edorg_lmdate
    from edfi.studenteducationorganizationassociation se
    group by se.studentusi, se.educationorganizationid
),
student_race as (
    select
        seoar.studentusi,
        seoar.educationorganizationid,
        array_remove(array_agg(mappedracedescriptor.mappedvalue::text), null) as race_array
    from edfi.studenteducationorganizationassociationrace seoar
        join edfi.descriptor racedescriptor
            on seoar.racedescriptorid = racedescriptor.descriptorid
        left join edfi.descriptormapping mappedracedescriptor
            on mappedracedescriptor.value = racedescriptor.codevalue
                and mappedracedescriptor.namespace = racedescriptor.namespace
                and mappedracedescriptor.mappednamespace = 'uri://1edtech.org/oneroster12/RaceDescriptor'
    group by seoar.studentusi, seoar.educationorganizationid
)
-- property documentation at
-- https://www.imsglobal.org/sites/default/files/spec/oneroster/v1p2/rostering-restbinding/OneRosterv1p2RosteringService_RESTBindv1p0.html#Main6p10p2
select
    md5(
        case
            when seo.educationorganizationid is null then concat('STU-', student.studentuniqueid::text)
            else concat('STU-', student.studentuniqueid::text, '-', seo.educationorganizationid::text)
        end
    ) as "sourcedId", -- unique ID constructed from natural key of Ed-Fi Students
    'active' as "status",
    greatest(
        student.lastmodifieddate,
        coalesce(seo.edorg_lmdate, student.lastmodifieddate)
    ) as "dateLastModified",
    birthdate::text as "birthDate",
    mappedsexdescriptor.mappedvalue as "sex",
    -- OneRoster spec expects the _string_ "true" or "false", not a JSON boolean value
    case when coalesce(sr.race_array, array[]::text[]) @> array['americanIndianOrAlaskaNative'] then 'true' else 'false' end         as "americanIndianOrAlaskaNative",
    case when coalesce(sr.race_array, array[]::text[]) @> array['asian'] then 'true' else 'false' end                                as "asian",
    case when coalesce(sr.race_array, array[]::text[]) @> array['blackOrAfricanAmerican'] then 'true' else 'false' end               as "blackOrAfricanAmerican",
    case when coalesce(sr.race_array, array[]::text[]) @> array['nativeHawaiianOrOtherPacificIslander'] then 'true' else 'false' end as "nativeHawaiianOrOtherPacificIslander",
    case when coalesce(sr.race_array, array[]::text[]) @> array['white'] then 'true' else 'false' end                                as "white",
    case when coalesce(array_length(sr.race_array, 1), 0) > 1 then 'true' else 'false' end as "demographicRaceTwoOrMoreRaces",
    case when coalesce(seo.hispaniclatinoethnicity, false) then 'true' else 'false' end as "hispanicOrLatinoEthnicity",
    countrydescriptor.codevalue as "countryOfBirthCode",
    statedescriptor.codevalue as "stateOfBirthAbbreviation",
    birthcity as "cityOfBirth",
    null as "publicSchoolResidenceStatus",
    student.studentusi as "studentUSI",
    seo.educationorganizationid as "educationOrganizationId",
    json_build_object(
        'edfi', json_build_object(
            'resource', 'students',
            'naturalKey', json_build_object(
                'studentUniqueId', student.studentUniqueId
            )
        )
    ) AS metadata
from student
    left join student_edorg seo
        on student.studentusi = seo.studentusi
    left join student_race sr
        on student.studentusi = sr.studentusi
        and sr.educationorganizationid = seo.educationorganizationid
    left join edfi.descriptor sexdescriptor
        on student.birthsexdescriptorid=sexdescriptor.descriptorid
    left join edfi.descriptormapping mappedsexdescriptor
        on mappedsexdescriptor.value=sexdescriptor.codevalue
            and mappedsexdescriptor.namespace=sexdescriptor.namespace
            and mappedsexdescriptor.mappednamespace='uri://1edtech.org/oneroster12/SexDescriptor'
    left join edfi.descriptor countrydescriptor
        on student.birthcountrydescriptorid=countrydescriptor.descriptorid
    left join edfi.descriptor statedescriptor
        on student.birthstateabbreviationdescriptorid=statedescriptor.descriptorid;

-- Add an index so the materialized view can be refreshed _concurrently_:
create index if not exists demographics_sourcedid ON oneroster12.demographics ("sourcedId");

-- Authorization filters: org and student lookups
create index if not exists demographics_educationorganizationid on oneroster12.demographics ("educationOrganizationId");
create index if not exists demographics_studentusi on oneroster12.demographics ("studentUSI");
